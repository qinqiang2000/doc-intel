import { describe, expect, it } from "vitest";
import { streamSse } from "../sse";

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(new TextEncoder().encode(chunks[i++]));
    },
  });
}

function fakeFetch(chunks: string[]) {
  return async () => ({ body: makeStream(chunks) }) as Response;
}

describe("streamSse", () => {
  it("parses single event with named event type and JSON data", async () => {
    const chunks = [
      "event: predict_progress\ndata: {\"a\":1}\n\n",
    ];
    const events: { event: string; data: unknown }[] = [];
    for await (const e of streamSse<{ a: number }>("/x", { fetchImpl: fakeFetch(chunks) })) {
      events.push(e);
    }
    expect(events).toEqual([{ event: "predict_progress", data: { a: 1 } }]);
  });

  it("parses multiple events in one stream", async () => {
    const chunks = [
      "event: a\ndata: {\"i\":1}\n\nevent: a\ndata: {\"i\":2}\n\nevent: done\ndata: {\"total\":2}\n\n",
    ];
    const out: unknown[] = [];
    for await (const e of streamSse<unknown>("/x", { fetchImpl: fakeFetch(chunks) })) {
      out.push(e);
    }
    expect(out).toHaveLength(3);
    expect((out[2] as { event: string }).event).toBe("done");
  });

  it("buffers partial chunks across stream reads", async () => {
    const chunks = ["event: a\nda", "ta: {\"k\":\"v\"}\n", "\n"];
    const out: unknown[] = [];
    for await (const e of streamSse<unknown>("/x", { fetchImpl: fakeFetch(chunks) })) {
      out.push(e);
    }
    expect(out).toEqual([{ event: "a", data: { k: "v" } }]);
  });
});
