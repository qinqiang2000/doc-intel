import { describe, expect, it } from "vitest";
import { transform } from "../json-formats";
import type { Annotation } from "../../stores/predict-store";

const ann = (
  id: string,
  field_name: string,
  partial: Partial<Annotation> = {}
): Annotation => ({
  id, document_id: "d-1", field_name,
  field_value: "v", field_type: "string",
  bounding_box: { x: 0.1, y: 0.1, w: 0.2, h: 0.05, page: 0 },
  source: "ai_detected", confidence: 0.95, is_ground_truth: false,
  created_by: "u-1", updated_by_user_id: null,
  created_at: "", updated_at: "",
  ...partial,
});

describe("json-formats.transform", () => {
  describe("flat", () => {
    it("returns structured_data unchanged (reference-equal)", () => {
      const sd = { a: 1, b: "x" };
      expect(transform("flat", { structuredData: sd, annotations: [] })).toBe(sd);
    });
  });

  describe("detailed", () => {
    it("wraps a leaf scalar with matching annotation as {value, confidence, bbox}", () => {
      const sd = { invoice_number: "INV-001" };
      const anns = [ann("a-1", "invoice_number", { confidence: 0.9 })];
      const out = transform("detailed", { structuredData: sd, annotations: anns });
      expect(out).toEqual({
        invoice_number: {
          value: "INV-001",
          confidence: 0.9,
          bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.05, page: 0 },
        },
      });
    });

    it("wraps leaf without matching annotation as {value, confidence: null, bbox: null}", () => {
      const sd = { unknown_field: "x" };
      const out = transform("detailed", { structuredData: sd, annotations: [] });
      expect(out).toEqual({
        unknown_field: { value: "x", confidence: null, bbox: null },
      });
    });

    it("recurses into nested objects", () => {
      const sd = { meta: { rev: 2 } };
      const anns = [ann("a-1", "meta.rev", { confidence: 0.5 })];
      const out = transform("detailed", { structuredData: sd, annotations: anns });
      expect(out).toEqual({
        meta: { rev: { value: 2, confidence: 0.5, bbox: anns[0].bounding_box } },
      });
    });

    it("treats arrays as leaves (does not recurse into items)", () => {
      const sd = { items: [{ qty: 1 }, { qty: 2 }] };
      const anns = [ann("a-1", "items", { confidence: 0.7 })];
      const out = transform("detailed", { structuredData: sd, annotations: anns }) as {
        items: { value: unknown; confidence: number | null; bbox: unknown };
      };
      expect(out.items.value).toEqual([{ qty: 1 }, { qty: 2 }]);
      expect(out.items.confidence).toBe(0.7);
    });
  });

  describe("grouped", () => {
    it("partitions buyer_/seller_/items/other into named groups", () => {
      const sd = {
        buyer_name: "Acme", buyer_tax_id: "X1",
        seller_name: "F9", seller_tax_id: "Y2",
        items: [{ qty: 1 }],
        invoice_number: "INV-001",
      };
      const out = transform("grouped", { structuredData: sd, annotations: [] });
      expect(out).toEqual({
        buyer: { name: "Acme", tax_id: "X1" },
        seller: { name: "F9", tax_id: "Y2" },
        line_items: [{ qty: 1 }],
        meta: { invoice_number: "INV-001" },
      });
    });

    it("returns { meta: {} } for empty input", () => {
      expect(transform("grouped", { structuredData: {}, annotations: [] })).toEqual({
        meta: {},
      });
    });

    it("returns { meta: {} } for null input (and never crashes)", () => {
      expect(transform("grouped", { structuredData: null, annotations: [] })).toEqual({
        meta: {},
      });
    });

    it("non-invoice template keeps everything under meta", () => {
      const sd = { article_id: "A1", word_count: 200 };
      expect(transform("grouped", { structuredData: sd, annotations: [] })).toEqual({
        meta: { article_id: "A1", word_count: 200 },
      });
    });
  });
});
