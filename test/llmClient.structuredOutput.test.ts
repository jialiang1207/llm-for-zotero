import { assert } from "chai";
import { config } from "../package.json";
import { callLLM } from "../src/utils/llmClient";

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

describe("llmClient structured output", function () {
  let originalZotero: unknown;
  let originalToolkit: unknown;

  let prefStore: Map<string, unknown>;
  let lastRequest: {
    url: string;
    init?: RequestInit;
  } | null;
  let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

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

  beforeEach(function () {
    prefStore = new Map<string, unknown>();
    lastRequest = null;

    const g = globalThis as TestGlobal;
    g.Zotero = {
      Prefs: {
        get: (key: string) => prefStore.get(key),
        set: (key: string, value: unknown) => {
          prefStore.set(key, value);
        },
      },
    };

    prefStore.set(`${config.prefsPrefix}.modelProviderGroupsMigrationVersion`, 1);
    prefStore.set(
      `${config.prefsPrefix}.apiBase`,
      "https://api.openai.com/v1/chat/completions",
    );
    prefStore.set(`${config.prefsPrefix}.apiKey`, "sk-test");
    prefStore.set(`${config.prefsPrefix}.model`, "gpt-4o-mini");

    fetchImpl = async (url: string, init?: RequestInit) => {
      lastRequest = { url, init };
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"title":"OK"}' } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    g.ztoolkit = {
      getGlobal: (name: string) => {
        if (name === "fetch") return fetchImpl;
        return undefined;
      },
      log: () => {},
    };
  });

  it("sends response_format json_schema for chat completions", async function () {
    const schema = {
      type: "object",
      properties: {
        title: { type: "string" },
      },
      required: ["title"],
      additionalProperties: false,
    };

    const output = await callLLM({
      prompt: "Return a title",
      structuredOutput: {
        name: "paper_summary_v1",
        schema,
        strict: true,
      },
    });

    assert.equal(output, '{"title":"OK"}');
    assert.isNotNull(lastRequest);
    assert.equal(
      lastRequest?.url,
      "https://api.openai.com/v1/chat/completions",
    );

    const payload = JSON.parse(String(lastRequest?.init?.body || "{}")) as {
      response_format?: {
        type?: string;
        json_schema?: {
          name?: string;
          schema?: unknown;
          strict?: boolean;
        };
      };
    };

    assert.equal(payload.response_format?.type, "json_schema");
    assert.equal(
      payload.response_format?.json_schema?.name,
      "paper_summary_v1",
    );
    assert.deepEqual(payload.response_format?.json_schema?.schema, schema);
    assert.isTrue(payload.response_format?.json_schema?.strict === true);
  });

  it("serializes structured object content returned by responses API", async function () {
    const schema = {
      type: "object",
      properties: {
        answer: { type: "string" },
      },
      required: ["answer"],
      additionalProperties: false,
    };

    fetchImpl = async (url: string, init?: RequestInit) => {
      lastRequest = { url, init };
      return new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: "output_json",
                  output_json: { answer: "Structured OK" },
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    const output = await callLLM({
      prompt: "Return structured answer",
      apiBase: "https://api.openai.com/v1/responses",
      structuredOutput: {
        schema,
      },
    });

    assert.equal(output, '{"answer":"Structured OK"}');
    assert.equal(lastRequest?.url, "https://api.openai.com/v1/responses");

    const payload = JSON.parse(String(lastRequest?.init?.body || "{}")) as {
      response_format?: {
        type?: string;
        json_schema?: {
          name?: string;
        };
      };
    };
    assert.equal(payload.response_format?.type, "json_schema");
    assert.equal(payload.response_format?.json_schema?.name, "structured_output");
  });
});
