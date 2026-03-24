interface DohAnswer {
  name: string;
  type: number;
  data: string;
}

interface DohResponse {
  Answer?: DohAnswer[];
}

export async function queryDnsTxt(domain: string): Promise<string[]> {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", domain);
  url.searchParams.set("type", "TXT");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/dns-json" },
  });

  if (!res.ok) {
    throw new Error(`DNS query failed: ${res.status}`);
  }

  const data: DohResponse = await res.json();

  // TXT records are type 16; data is quoted, strip surrounding quotes
  return (data.Answer ?? [])
    .filter((a) => a.type === 16)
    .map((a) => a.data.replace(/^"|"$/g, ""));
}
