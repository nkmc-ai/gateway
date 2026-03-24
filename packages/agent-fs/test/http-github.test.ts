import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  HttpBackend,
  type HttpBackendConfig,
  type HttpResource,
} from "../src/backends/http.js";

// --- Mock GitHub API data ---

interface GhIssue {
  number: number;
  title: string;
  state: string;
  body: string;
}

interface GhComment {
  id: number;
  body: string;
  user: string;
}

interface GhContent {
  name: string;
  path: string;
  sha: string;
  type: "file" | "dir";
  content?: string;
  encoding?: string;
}

const issues: GhIssue[] = [
  { number: 1, title: "Bug report", state: "open", body: "Something broken" },
  { number: 2, title: "Feature request", state: "open", body: "Add dark mode" },
  { number: 3, title: "Docs update", state: "closed", body: "Fix typos" },
  { number: 4, title: "Performance", state: "open", body: "Slow queries" },
  { number: 5, title: "Security fix", state: "open", body: "XSS vuln" },
];

const comments: Record<number, GhComment[]> = {
  1: [
    { id: 101, body: "I can reproduce this", user: "alice" },
    { id: 102, body: "Working on a fix", user: "bob" },
  ],
  2: [
    { id: 201, body: "+1 for dark mode", user: "charlie" },
  ],
};

const contents: Map<string, GhContent | GhContent[]> = new Map();
// Root directory listing
contents.set("", [
  { name: "README.md", path: "README.md", sha: "abc111", type: "file" },
  { name: "src", path: "src", sha: "abc222", type: "dir" },
  { name: "package.json", path: "package.json", sha: "abc333", type: "file" },
]);
// src/ directory listing
contents.set("src", [
  { name: "index.ts", path: "src/index.ts", sha: "def111", type: "file" },
  { name: "utils.ts", path: "src/utils.ts", sha: "def222", type: "file" },
]);
// Individual files
contents.set("README.md", {
  name: "README.md",
  path: "README.md",
  sha: "abc111",
  type: "file",
  content: btoa("# Hello World"),
  encoding: "base64",
});
contents.set("package.json", {
  name: "package.json",
  path: "package.json",
  sha: "abc333",
  type: "file",
  content: btoa('{"name": "test"}'),
  encoding: "base64",
});
contents.set("src/index.ts", {
  name: "index.ts",
  path: "src/index.ts",
  sha: "def111",
  type: "file",
  content: btoa('console.log("hello")'),
  encoding: "base64",
});
contents.set("src/utils.ts", {
  name: "utils.ts",
  path: "src/utils.ts",
  sha: "def222",
  type: "file",
  content: btoa("export const add = (a: number, b: number) => a + b"),
  encoding: "base64",
});

// --- Mock GitHub API server ---

function json(res: ServerResponse, status: number, data: unknown, headers?: Record<string, string>) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(data));
}

function createMockGhServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const method = req.method ?? "GET";

      // Verify auth
      const auth = req.headers.authorization;
      if (auth !== "Bearer ghp-test") {
        json(res, 401, { message: "Bad credentials" });
        return;
      }

      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = chunks.length
          ? JSON.parse(Buffer.concat(chunks).toString())
          : undefined;

        const port = (srv.address() as { port: number }).port;
        const baseUrl = `http://localhost:${port}`;

        // --- Issues ---

        // GET /repos/:owner/:repo/issues (with pagination)
        const issuesListMatch = path.match(
          /^\/repos\/([^/]+)\/([^/]+)\/issues$/,
        );
        if (issuesListMatch && method === "GET") {
          const page = parseInt(url.searchParams.get("page") ?? "1");
          const perPage = parseInt(url.searchParams.get("per_page") ?? "2");
          const start = (page - 1) * perPage;
          const end = start + perPage;
          const pageItems = issues.slice(start, end);
          const totalPages = Math.ceil(issues.length / perPage);

          const linkParts: string[] = [];
          if (page < totalPages) {
            linkParts.push(
              `<${baseUrl}${path}?page=${page + 1}&per_page=${perPage}>; rel="next"`,
            );
          }
          if (page > 1) {
            linkParts.push(
              `<${baseUrl}${path}?page=${page - 1}&per_page=${perPage}>; rel="prev"`,
            );
          }

          const headers: Record<string, string> = {};
          if (linkParts.length > 0) headers["Link"] = linkParts.join(", ");

          return json(res, 200, pageItems, headers);
        }

        // GET /repos/:owner/:repo/issues/:number
        const issueItemMatch = path.match(
          /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/,
        );
        if (issueItemMatch && method === "GET") {
          const num = parseInt(issueItemMatch[3]);
          const issue = issues.find((i) => i.number === num);
          if (!issue) return json(res, 404, { message: "Not Found" });
          return json(res, 200, issue);
        }

        // POST /repos/:owner/:repo/issues
        if (issuesListMatch && method === "POST") {
          const newIssue: GhIssue = {
            number: issues.length + 1,
            title: body.title,
            state: "open",
            body: body.body ?? "",
          };
          issues.push(newIssue);
          return json(res, 201, newIssue);
        }

        // PATCH /repos/:owner/:repo/issues/:number
        if (issueItemMatch && method === "PATCH") {
          const num = parseInt(issueItemMatch[3]);
          const issue = issues.find((i) => i.number === num);
          if (!issue) return json(res, 404, { message: "Not Found" });
          Object.assign(issue, body);
          return json(res, 200, issue);
        }

        // --- Issue Comments ---

        // GET /repos/:owner/:repo/issues/:number/comments
        const commentsListMatch = path.match(
          /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/,
        );
        if (commentsListMatch && method === "GET") {
          const num = parseInt(commentsListMatch[3]);
          return json(res, 200, comments[num] ?? []);
        }

        // POST /repos/:owner/:repo/issues/:number/comments
        if (commentsListMatch && method === "POST") {
          const num = parseInt(commentsListMatch[3]);
          if (!comments[num]) comments[num] = [];
          const newComment: GhComment = {
            id: Date.now(),
            body: body.body,
            user: "test-user",
          };
          comments[num].push(newComment);
          return json(res, 201, newComment);
        }

        // --- Contents ---

        // Match /repos/:owner/:repo/contents or /repos/:owner/:repo/contents/...
        const contentsMatch = path.match(
          /^\/repos\/([^/]+)\/([^/]+)\/contents(?:\/(.*))?$/,
        );
        if (contentsMatch) {
          const filePath = contentsMatch[3] ?? "";

          if (method === "GET") {
            const entry = contents.get(filePath);
            if (!entry) return json(res, 404, { message: "Not Found" });
            return json(res, 200, entry);
          }

          if (method === "PUT") {
            // Create or update file
            const existing = contents.get(filePath);
            if (existing && !Array.isArray(existing)) {
              // Update: require sha
              if (body.sha !== existing.sha) {
                return json(res, 409, { message: "SHA mismatch" });
              }
              const newSha = "sha-" + Date.now();
              const updated: GhContent = {
                name: existing.name,
                path: existing.path,
                sha: newSha,
                type: "file",
                content: body.content,
                encoding: "base64",
              };
              contents.set(filePath, updated);
              return json(res, 200, { content: updated });
            }
            // Create new file
            const name = filePath.split("/").pop() ?? filePath;
            const newSha = "sha-" + Date.now();
            const newFile: GhContent = {
              name,
              path: filePath,
              sha: newSha,
              type: "file",
              content: body.content,
              encoding: "base64",
            };
            contents.set(filePath, newFile);
            return json(res, 201, { content: newFile });
          }

          if (method === "DELETE") {
            const existing = contents.get(filePath);
            if (!existing || Array.isArray(existing)) {
              return json(res, 404, { message: "Not Found" });
            }
            if (body?.sha !== existing.sha) {
              return json(res, 409, { message: "SHA mismatch" });
            }
            contents.delete(filePath);
            return json(res, 200, { commit: { sha: "commit-" + Date.now() } });
          }
        }

        json(res, 404, { message: "Not Found" });
      });
    });

    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server: srv, baseUrl: `http://localhost:${port}` });
    });
  });
}

// --- GitHub resource configuration ---

function createGhResources(): HttpResource[] {
  return [
    {
      name: "issues",
      apiPath: "/repos/:owner/:repo/issues",
      idField: "number",
      updateMethod: "PATCH",
      children: [
        { name: "comments", idField: "id" },
      ],
    },
    {
      name: "contents",
      apiPath: "/repos/:owner/:repo/contents",
      pathMode: "tree",
      idField: "path",
      transform: {
        read: (d: unknown) => {
          const data = d as GhContent;
          if (data.type === "file" && data.content) {
            return { ...data, content: atob(data.content) };
          }
          return data;
        },
        write: (d: unknown) => {
          const data = d as { content: string; message?: string; sha?: string };
          return {
            message: data.message ?? "update",
            content: btoa(data.content),
            ...(data.sha ? { sha: data.sha } : {}),
          };
        },
        remove: (r: unknown) => {
          const data = r as { sha: string };
          return { message: "delete", sha: data.sha };
        },
        list: (item: unknown) => {
          const data = item as { name: string; type: string };
          return data.type === "dir" ? data.name + "/" : data.name;
        },
      },
      readBeforeWrite: {
        inject: (r: unknown, d: unknown) => {
          const readResult = r as { sha: string };
          return { ...(d as object), sha: readResult.sha };
        },
      },
    },
  ];
}

function createGhConfig(baseUrl: string): HttpBackendConfig {
  return {
    baseUrl,
    auth: { type: "bearer", token: "ghp-test" },
    params: { owner: "test-org", repo: "test-repo" },
    pagination: { type: "link-header", maxPages: 5 },
    resources: createGhResources(),
  };
}

// --- Tests ---

describe("HttpBackend — GitHub integration", () => {
  let server: Server;
  let backend: HttpBackend;

  beforeAll(async () => {
    const mock = await createMockGhServer();
    server = mock.server;
    backend = new HttpBackend(createGhConfig(mock.baseUrl));
  });

  afterAll(
    () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
  );

  // --- Issues CRUD ---

  describe("Issues CRUD", () => {
    it("should list issues (paginated, all pages)", async () => {
      const result = await backend.list("/issues/");
      // 5 issues, per_page=2 by default in mock → 3 pages auto-fetched
      expect(result).toContain("1.json");
      expect(result).toContain("2.json");
      expect(result).toContain("3.json");
      expect(result).toContain("4.json");
      expect(result).toContain("5.json");
      expect(result).toHaveLength(5);
    });

    it("should read a single issue", async () => {
      const result = (await backend.read("/issues/1.json")) as GhIssue;
      expect(result.title).toBe("Bug report");
      expect(result.state).toBe("open");
    });

    it("should create an issue", async () => {
      const result = await backend.write("/issues/", {
        title: "New issue",
        body: "Test body",
      });
      expect(result.id).toBeDefined();
      expect(Number(result.id)).toBeGreaterThan(5);
    });

    it("should update an issue with PATCH", async () => {
      const result = await backend.write("/issues/1.json", {
        title: "Bug report (updated)",
      });
      expect(result.id).toBe("1");

      const updated = (await backend.read("/issues/1.json")) as GhIssue;
      expect(updated.title).toBe("Bug report (updated)");
    });
  });

  // --- Issue Comments (nested) ---

  describe("Issue comments", () => {
    it("should list comments under an issue", async () => {
      const result = await backend.list("/issues/1/comments/");
      expect(result).toContain("101.json");
      expect(result).toContain("102.json");
    });

    it("should create a comment", async () => {
      const result = await backend.write("/issues/2/comments/", {
        body: "Great idea!",
      });
      expect(result.id).toBeDefined();
    });

    it("should list comments for an issue with no comments", async () => {
      const result = await backend.list("/issues/3/comments/");
      expect(result).toEqual([]);
    });
  });

  // --- Pagination ---

  describe("Pagination", () => {
    it("should auto-follow Link header for all pages", async () => {
      // The mock returns 2 items per page, 5 total → pages 1,2,3
      const result = await backend.list("/issues/");
      expect(result).toHaveLength(6); // 5 original + 1 created in earlier test
    });
  });

  // --- Contents tree mode ---

  describe("Contents tree mode", () => {
    it("should list root directory", async () => {
      const result = await backend.list("/contents/");
      expect(result).toContain("README.md");
      expect(result).toContain("src/");
      expect(result).toContain("package.json");
    });

    it("should list subdirectory", async () => {
      const result = await backend.list("/contents/src");
      expect(result).toContain("index.ts");
      expect(result).toContain("utils.ts");
    });

    it("should read a file (base64 auto-decoded)", async () => {
      const result = (await backend.read("/contents/README.md")) as GhContent;
      expect(result.content).toBe("# Hello World");
      expect(result.type).toBe("file");
    });

    it("should read a nested file", async () => {
      const result = (await backend.read(
        "/contents/src/index.ts",
      )) as GhContent;
      expect(result.content).toBe('console.log("hello")');
    });
  });

  // --- Contents readBeforeWrite ---

  describe("Contents readBeforeWrite", () => {
    it("should update a file with auto-injected SHA", async () => {
      const result = await backend.write("/contents/README.md", {
        content: "# Updated",
      });
      expect(result.id).toBeDefined();

      // Verify the file was updated
      const updated = (await backend.read("/contents/README.md")) as GhContent;
      expect(updated.content).toBe("# Updated");
    });

    it("should create a new file (readBeforeWrite 404 graceful skip)", async () => {
      const result = await backend.write("/contents/new-file.md", {
        content: "# New File",
      });
      expect(result.id).toBeDefined();
    });
  });

  // --- Contents delete ---

  describe("Contents delete", () => {
    it("should delete a file with SHA in body", async () => {
      // First read to verify it exists
      const before = (await backend.read(
        "/contents/package.json",
      )) as GhContent;
      expect(before.content).toBe('{"name": "test"}');

      // Delete
      await backend.remove("/contents/package.json");

      // Verify it's gone
      await expect(backend.read("/contents/package.json")).rejects.toThrow();
    });
  });

  // --- Auth ---

  describe("Auth pass-through", () => {
    it("should pass Bearer token in requests", async () => {
      // If auth works, we can read issues; if not, we'd get 401
      const result = (await backend.read("/issues/2.json")) as GhIssue;
      expect(result.title).toBe("Feature request");
    });

    it("should fail with wrong auth token", async () => {
      const port = (server.address() as { port: number }).port;
      const badBackend = new HttpBackend({
        ...createGhConfig(`http://localhost:${port}`),
        auth: { type: "bearer", token: "wrong-token" },
      });

      // 401 → non-array → empty list
      const result = await badBackend.list("/issues/");
      expect(result).toEqual([]);
    });
  });

  // --- AgentFs integration ---

  describe("AgentFs integration", () => {
    it("should work as a mount in AgentFs", async () => {
      const { AgentFs } = await import("../src/agent-fs.js");

      const agentFs = new AgentFs({
        mounts: [{ path: "/gh", backend }],
      });

      // List mount root
      const lsRoot = await agentFs.execute("ls /");
      expect(lsRoot.ok).toBe(true);
      if (lsRoot.ok) {
        expect(lsRoot.data).toContain("gh/");
      }

      // List resources
      const lsGh = await agentFs.execute("ls /gh/");
      expect(lsGh.ok).toBe(true);
      if (lsGh.ok) {
        expect(lsGh.data).toContain("issues/");
        expect(lsGh.data).toContain("contents/");
      }

      // Read an issue
      const catIssue = await agentFs.execute("cat /gh/issues/2.json");
      expect(catIssue.ok).toBe(true);
      if (catIssue.ok) {
        expect((catIssue.data as GhIssue).title).toBe("Feature request");
      }

      // List contents (tree mode)
      const lsContents = await agentFs.execute("ls /gh/contents/");
      expect(lsContents.ok).toBe(true);
      if (lsContents.ok) {
        expect(lsContents.data).toContain("README.md");
        expect(lsContents.data).toContain("src/");
      }
    });
  });
});
