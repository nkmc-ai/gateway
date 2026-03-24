import { describe, it, expect, beforeEach } from "vitest";
import { MemoryBackend, NotFoundError } from "../src/backends/memory.js";

describe("MemoryBackend", () => {
  let backend: MemoryBackend;

  beforeEach(() => {
    backend = new MemoryBackend();
    backend.seed("users", [
      { id: "1", name: "Alice", status: "active" },
      { id: "2", name: "Bob", status: "inactive" },
      { id: "3", name: "Charlie", status: "active" },
    ]);
  });

  describe("list", () => {
    it("should list collections at root", async () => {
      const result = await backend.list("/");
      expect(result).toEqual(["users/"]);
    });

    it("should list record ids in a collection", async () => {
      const result = await backend.list("/users");
      expect(result).toEqual(["1.json", "2.json", "3.json"]);
    });

    it("should return empty for unknown collection", async () => {
      const result = await backend.list("/products");
      expect(result).toEqual([]);
    });
  });

  describe("read", () => {
    it("should read a single record", async () => {
      const result = await backend.read("/users/1.json");
      expect(result).toEqual({ id: "1", name: "Alice", status: "active" });
    });

    it("should read all records in a collection", async () => {
      const result = (await backend.read("/users")) as unknown[];
      expect(result).toHaveLength(3);
    });

    it("should read _schema", async () => {
      const result = (await backend.read("/users/_schema")) as {
        collection: string;
        fields: unknown[];
      };
      expect(result.collection).toBe("users");
      expect(result.fields).toBeDefined();
    });

    it("should read _count", async () => {
      const result = (await backend.read("/users/_count")) as { count: number };
      expect(result.count).toBe(3);
    });

    it("should throw NotFoundError for missing record", async () => {
      await expect(backend.read("/users/999.json")).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe("write", () => {
    it("should create a new record", async () => {
      const result = await backend.write("/users/", {
        name: "Dave",
        status: "active",
      });
      expect(result.id).toBeDefined();

      const record = (await backend.read(`/users/${result.id}.json`)) as {
        name: string;
      };
      expect(record.name).toBe("Dave");
    });

    it("should update an existing record", async () => {
      await backend.write("/users/1.json", { name: "Alice Updated" });
      const record = (await backend.read("/users/1.json")) as { name: string };
      expect(record.name).toBe("Alice Updated");
    });

    it("should throw NotFoundError when updating non-existent record", async () => {
      await expect(
        backend.write("/users/999.json", { name: "Ghost" }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("remove", () => {
    it("should delete a record", async () => {
      await backend.remove("/users/1.json");
      const list = await backend.list("/users");
      expect(list).not.toContain("1.json");
    });

    it("should throw NotFoundError for missing record", async () => {
      await expect(backend.remove("/users/999.json")).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe("search", () => {
    it("should find records matching pattern", async () => {
      const results = (await backend.search("/users", "active")) as {
        name: string;
      }[];
      // Alice and Charlie are active, but Bob has "inactive" which also contains "active"
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("should return empty for no matches", async () => {
      const results = await backend.search("/users", "zzz_no_match");
      expect(results).toEqual([]);
    });
  });
});
