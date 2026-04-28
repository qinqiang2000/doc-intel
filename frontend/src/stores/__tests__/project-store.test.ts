import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../../lib/api-client";
import { useProjectStore } from "../project-store";

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  useProjectStore.setState({
    projects: [],
    templates: [],
    loading: false,
    error: null,
  });
});

afterEach(() => mock.restore());

const TPL_RESP = [
  { key: "custom", display_name: "✨ 自定义", description: "", expected_fields: [], recommended_processor: "gemini" },
  { key: "japan_receipt", display_name: "🇯🇵 日本領収書", description: "", expected_fields: ["doc_type"], recommended_processor: "gemini" },
];

const PROJECT_RESP = {
  id: "p-1", workspace_id: "ws-1", name: "P", slug: "p",
  description: null, template_key: "custom", created_by: "u-1",
  created_at: "2026-04-28T00:00:00Z", updated_at: "2026-04-28T00:00:00Z",
  deleted_at: null,
};

describe("project-store", () => {
  it("loadTemplates fetches and caches templates", async () => {
    mock.onGet("/api/v1/templates").reply(200, TPL_RESP);
    await useProjectStore.getState().loadTemplates();
    expect(useProjectStore.getState().templates).toHaveLength(2);
  });

  it("loadProjects populates state", async () => {
    mock.onGet("/api/v1/workspaces/ws-1/projects").reply(200, [PROJECT_RESP]);
    await useProjectStore.getState().loadProjects("ws-1");
    expect(useProjectStore.getState().projects).toHaveLength(1);
    expect(useProjectStore.getState().projects[0].slug).toBe("p");
  });

  it("loadProjects sets error on failure", async () => {
    mock.onGet("/api/v1/workspaces/ws-1/projects").reply(403, {
      error: { code: "forbidden", message: "no access" },
    });
    await useProjectStore.getState().loadProjects("ws-1");
    expect(useProjectStore.getState().error).toBe("no access");
  });

  it("createProject appends to list and returns it", async () => {
    mock.onPost("/api/v1/workspaces/ws-1/projects").reply(201, PROJECT_RESP);
    const p = await useProjectStore.getState().createProject("ws-1", {
      name: "P", slug: "p", template_key: "custom",
    });
    expect(p.id).toBe("p-1");
    expect(useProjectStore.getState().projects).toHaveLength(1);
  });

  it("deleteProject removes from list", async () => {
    useProjectStore.setState({ projects: [PROJECT_RESP] as never });
    mock.onDelete("/api/v1/workspaces/ws-1/projects/p-1").reply(204);
    await useProjectStore.getState().deleteProject("ws-1", "p-1");
    expect(useProjectStore.getState().projects).toHaveLength(0);
  });

  it("createProject re-throws on failure (caller handles)", async () => {
    mock.onPost("/api/v1/workspaces/ws-1/projects").reply(409, {
      error: { code: "project_slug_taken", message: "Taken" },
    });
    await expect(
      useProjectStore.getState().createProject("ws-1", {
        name: "P", slug: "p", template_key: "custom",
      })
    ).rejects.toMatchObject({ code: "project_slug_taken" });
  });
});
