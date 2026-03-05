import { assert } from "chai";
import { config } from "../package.json";
import { callEmbeddings } from "../src/utils/llmClient";

type TestGlobal = typeof globalThis & {
  Zotero?: {
    Prefs: {
      get: (key: string) => unknown;
      set: (key: string, value: unknown, global?: boolean) => void;
    };
  };
  ztoolkit?: {
    getGlobal: (name: string) => unknown;
    log: (...args: unknown[]) => void;
  };
};

describe("llmClient embeddings", function () {
  let originalZotero: unknown;
  let originalToolkit: unknown;

  let prefStore: Map<string, unknown>;
  let requests: Array<{
    url: string;
    init?: RequestInit;
  }>;

  before(function () {
    const g = globalThis as TestGlobal;
    originalZotero = g.Zotero;
    originalToolkit = g.ztoolkit;
  });

  after(function () {
    const g = globalThis as TestGlobal;
    g.Zotero = originalZotero as TestGlobal["Zotero"];
    g.ztoolkit = originalToolkit as TestGlobal["ztoolkit"];
  });

  const installMocks = function () {
    prefStore = new Map<string, unknown>();
    requests = [];

    const g = globalThis as TestGlobal;
    g.Zotero = {
      Prefs: {
        get: (key: string) => prefStore.get(key),
        set: (key: string, value: unknown) => {
          prefStore.set(key, value);
        },
      },
    };

    const fetchMock = async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    g.ztoolkit = {
      getGlobal: (name: string) => {
        if (name === "fetch") return fetchMock;
        return undefined;
      },
      log: () => {},
    };
  };

  beforeEach(function () {
    installMocks();
    prefStore.set(
      `${config.prefsPrefix}.modelProviderGroupsMigrationVersion`,
      1,
    );
    prefStore.set(
      `${config.prefsPrefix}.apiBase`,
      "https://api.openai.com/v1/chat/completions",
    );
    prefStore.set(`${config.prefsPrefix}.apiKey`, "sk-test");
  });

  it("uses custom embedding model from preferences", async function () {
    prefStore.set(`${config.prefsPrefix}.customEmbeddingModelEnabled`, true);
    prefStore.set(
      `${config.prefsPrefix}.embeddingModel`,
      "text-embedding-3-large",
    );

    const result = await callEmbeddings(["chunk A", "chunk B"]);

    assert.lengthOf(result, 1);
    assert.deepEqual(result[0], [0.1, 0.2, 0.3]);
    assert.lengthOf(requests, 1);
    assert.equal(requests[0].url, "https://api.openai.com/v1/embeddings");

    const payload = JSON.parse(String(requests[0].init?.body || "{}")) as {
      model?: string;
      input?: string[];
    };
    assert.equal(payload.model, "text-embedding-3-large");
    assert.deepEqual(payload.input, ["chunk A", "chunk B"]);
  });

  it("falls back to default embedding model when preference is empty", async function () {
    prefStore.set(`${config.prefsPrefix}.customEmbeddingModelEnabled`, true);
    prefStore.set(`${config.prefsPrefix}.embeddingModel`, "");

    await callEmbeddings(["hello"]);

    assert.lengthOf(requests, 1);
    const payload = JSON.parse(String(requests[0].init?.body || "{}")) as {
      model?: string;
    };
    assert.equal(payload.model, "text-embedding-3-small");
  });

  it("uses default embedding model when custom embedding is disabled", async function () {
    prefStore.set(`${config.prefsPrefix}.customEmbeddingModelEnabled`, false);
    prefStore.set(
      `${config.prefsPrefix}.embeddingModel`,
      "text-embedding-3-large",
    );

    await callEmbeddings(["hello"]);

    assert.lengthOf(requests, 1);
    const payload = JSON.parse(String(requests[0].init?.body || "{}")) as {
      model?: string;
    };
    assert.equal(payload.model, "text-embedding-3-small");
  });
});
