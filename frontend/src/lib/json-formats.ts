import type { Annotation } from "../stores/predict-store";

export type JsonFormat = "flat" | "detailed" | "grouped";

interface Args {
  structuredData: Record<string, unknown> | null;
  annotations: Annotation[];
}

interface Detailed {
  value: unknown;
  confidence: number | null;
  bbox: Record<string, number> | null;
}

function findAnn(anns: Annotation[], path: string[]): Annotation | undefined {
  const dotted = path.join(".");
  return (
    anns.find((a) => a.field_name === dotted) ??
    anns.find((a) => a.field_name === path[path.length - 1])
  );
}

function detailify(node: unknown, path: string[], anns: Annotation[]): unknown {
  if (node !== null && typeof node === "object" && !Array.isArray(node)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(node as Record<string, unknown>)) {
      out[k] = detailify((node as Record<string, unknown>)[k], [...path, k], anns);
    }
    return out;
  }
  // leaf (scalar OR array)
  const ann = findAnn(anns, path);
  return {
    value: node,
    confidence: ann?.confidence ?? null,
    bbox: ann?.bounding_box ?? null,
  } satisfies Detailed;
}

function group(
  sd: Record<string, unknown> | null,
): Record<string, unknown> {
  const buyer: Record<string, unknown> = {};
  const seller: Record<string, unknown> = {};
  const meta: Record<string, unknown> = {};
  let lineItems: unknown = undefined;

  if (sd) {
    for (const k of Object.keys(sd)) {
      const v = sd[k];
      if (k === "items") {
        lineItems = v;
      } else if (k.startsWith("buyer_")) {
        buyer[k.slice("buyer_".length)] = v;
      } else if (k.startsWith("seller_")) {
        seller[k.slice("seller_".length)] = v;
      } else {
        meta[k] = v;
      }
    }
  }

  const out: Record<string, unknown> = {};
  if (Object.keys(buyer).length) out.buyer = buyer;
  if (Object.keys(seller).length) out.seller = seller;
  if (lineItems !== undefined) out.line_items = lineItems;
  out.meta = meta; // always present
  return out;
}

export function transform(format: JsonFormat, args: Args): unknown {
  if (format === "flat") return args.structuredData;
  if (format === "detailed") {
    if (args.structuredData === null) return null;
    return detailify(args.structuredData, [], args.annotations);
  }
  return group(args.structuredData);
}
