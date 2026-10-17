
import test from "node:test";
import assert from "node:assert/strict";

import { discoverOperationalScripts } from "../src/checks/discoverOperationalScripts.js";

test("discovers development and start scripts", () => {
  const result = discoverOperationalScripts({
    components: [
      {
        path: "backend",
        scripts: {
          dev: "nodemon src/index.js",
          start: "node src/index.js",
        },
      },
    ],
  });

  assert.deepEqual(result, [
    {
      component: "backend",
      type: "dev",
      status: "available",
      script: "dev",
      command: "nodemon src/index.js",
    },
    {
      component: "backend",
      type: "start",
      status: "available",
      script: "start",
      command: "node src/index.js",
    },
  ]);
});

test("marks missing operational scripts as unavailable", () => {
  const result = discoverOperationalScripts({
    components: [
      {
        path: "frontend",
        scripts: {
          build: "vite build",
        },
      },
    ],
  });

  assert.deepEqual(result, [
    {
      component: "frontend",
      type: "dev",
      status: "unavailable",
      script: null,
      command: null,
    },
    {
      component: "frontend",
      type: "start",
      status: "unavailable",
      script: null,
      command: null,
    },
  ]);
});
