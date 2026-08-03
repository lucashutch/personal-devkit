// Created by the Herdr session-title integration.
// Keep HerdR tab labels in sync with the root OpenCode session title.
import net from "node:net";

const SOURCE = "herdr:opencode-session-title";
let requestSeq = Date.now() * 1000;
let requestChain = Promise.resolve();
let tabId;
let rootSessionID;

function request(method, params) {
  const pending = requestChain.then(() => requestOnce(method, params));
  requestChain = pending.catch(() => {});
  return pending;
}

function requestOnce(method, params) {
  const paneId = process.env.HERDR_PANE_ID;
  const socketPath = process.env.HERDR_SOCKET_PATH;
  if (!paneId || !socketPath) return Promise.resolve(undefined);

  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;
  const message = {
    id: `${SOURCE}:${Date.now()}:${++requestSeq}`,
    method,
    params: {
      pane_id: paneId,
      source: SOURCE,
      seq: ++requestSeq,
      ...params,
    },
  };

  return new Promise((resolve) => {
    const client = net.createConnection(endpoint, () => {
      client.write(`${JSON.stringify(message)}\n`);
    });
    let response = "";
    const finish = () => {
      client.destroy();
      try {
        resolve(JSON.parse(response));
      } catch {
        resolve(undefined);
      }
    };
    client.setTimeout(500, finish);
    client.on("data", (chunk) => {
      response += chunk.toString();
      if (response.includes("\n")) finish();
    });
    client.on("error", () => resolve(undefined));
    client.on("end", finish);
    client.on("close", () => resolve(undefined));
  });
}

async function renameTab(title) {
  const label = title?.trim();
  if (!label || label === "Untitled") return;

  if (!tabId) {
    const response = await request("pane.get", { pane_id: process.env.HERDR_PANE_ID });
    tabId = response?.result?.pane?.tab_id;
  }
  if (tabId) await request("tab.rename", { tab_id: tabId, label });
}

export default async () => {
  if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_SOCKET_PATH || !process.env.HERDR_PANE_ID) {
    return {};
  }

  return {
    event: async ({ event }) => {
      const info = event?.properties?.info;
      if (!info?.id || info.parentID || (rootSessionID && info.id !== rootSessionID)) return;

      if (event.type === "session.created") rootSessionID = info.id;
      if (event.type === "session.created" || event.type === "session.updated") {
        if (!rootSessionID) rootSessionID = info.id;
        await renameTab(info.title);
      }
    },
  };
};
