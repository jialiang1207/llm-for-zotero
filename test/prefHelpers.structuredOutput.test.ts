import { assert } from "chai";
import {
  getBooleanPref,
  getStructuredOutputConfigForRequest,
} from "../src/modules/contextPanel/prefHelpers";
import { config } from "../package.json";

type TestGlobal = typeof globalThis & {
  Zotero?: {
    Prefs: {
      get: (key: string) => unknown;
      set: (key: string, value: unknown, global?: boolean) => void;
    };
  };
};

describe("prefHelpers structured output", function () {
  let originalZotero: unknown;
  let prefStore: Map<string, unknown>;

  before(function () {
    const g = globalThis as TestGlobal;
    originalZotero = g.Zotero;
  });

  beforeEach(function () {
    prefStore = new Map<string, unknown>();
    const g = globalThis as TestGlobal;
    g.Zotero = {
      Prefs: {
        get: (key: string) => prefStore.get(key),
        set: (key: string, value: unknown) => {
          prefStore.set(key, value);
        },
      },
    };
  });

  after(function () {
    const g = globalThis as TestGlobal;
    g.Zotero = originalZotero as TestGlobal["Zotero"];
  });

  it("returns undefined when structured output is disabled", function () {
    prefStore.set(`${config.prefsPrefix}.structuredOutputEnabled`, false);
    prefStore.set(
      `${config.prefsPrefix}.structuredOutputSchema`,
      '{"type":"object"}',
    );

    const cfg = getStructuredOutputConfigForRequest();
    assert.isUndefined(cfg);
  });

  it("parses schema config when enabled", function () {
    prefStore.set(`${config.prefsPrefix}.structuredOutputEnabled`, true);
    prefStore.set(
      `${config.prefsPrefix}.structuredOutputSchemaName`,
      "paper_summary_v1",
    );
    prefStore.set(`${config.prefsPrefix}.structuredOutputStrict`, true);
    prefStore.set(
      `${config.prefsPrefix}.structuredOutputSchema`,
      '{"type":"object","properties":{"title":{"type":"string"}},"required":["title"]}',
    );

    const cfg = getStructuredOutputConfigForRequest();
    assert.isDefined(cfg);
    assert.equal(cfg?.name, "paper_summary_v1");
    assert.isTrue(cfg?.strict === true);
    assert.deepEqual(cfg?.schema, {
      type: "object",
      properties: {
        title: { type: "string" },
      },
      required: ["title"],
    });
  });

  it("returns undefined for invalid schema json", function () {
    prefStore.set(`${config.prefsPrefix}.structuredOutputEnabled`, true);
    prefStore.set(`${config.prefsPrefix}.structuredOutputSchema`, "{not-json");

    const cfg = getStructuredOutputConfigForRequest();
    assert.isUndefined(cfg);
  });

  it("reads boolean pref values from string fallback", function () {
    prefStore.set(`${config.prefsPrefix}.structuredOutputEnabled`, "true");
    assert.isTrue(getBooleanPref("structuredOutputEnabled", false));
  });
});
