export interface SseEvent<T> {
  event: string;
  data: T;
}

interface StreamSseOptions {
  fetchImpl?: typeof fetch;
}

export async function* streamSse<T>(
  url: string,
  init: RequestInit & StreamSseOptions = {}
): AsyncIterable<SseEvent<T>> {
  const { fetchImpl, ...fetchInit } = init as RequestInit & StreamSseOptions;
  const f = fetchImpl ?? fetch;
  const resp = await f(url, fetchInit);
  if (!resp.body) return;
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let eventName = "message";
      let dataStr = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
      }
      if (dataStr) {
        yield { event: eventName, data: JSON.parse(dataStr) as T };
      }
    }
  }
}
