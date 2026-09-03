// Keep HerdR tab labels in sync with the root OpenCode session the pane shows.
//
// This runs in the TUI process, not the server, because only the TUI knows
// which session is selected. The server-side plugin this replaces latched the
// first root session it saw, so switching session (or resuming an older one)
// left the tab holding the previous label forever.
//
// `route.current` is polled rather than latched: the poll is the only thing
// that notices a session switch, a title arriving late, or a rename.
import net from "node:net";

const SOURCE = "herdr:opencode-session-title";
const ROUTE_POLL_INTERVAL_MS = 100;

let requestSeq = Date.now() * 1000;
let requestChain = Promise.resolve();

export function request(method, params) {
  const pending = requestChain.then(() => requestOnce(method, params));
  requestChain = pending.catch(() => {});
  return pending;
}

function requestOnce(method, params) {
  const paneId = process.env.HERDR_PANE_ID;
  const socketPath = process.env.HERDR_SOCKET_PATH;
  if (!paneId || !socketPath) return Promise.resolve(undefined);

  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;
  requestSeq += 1;
  const message = {
    id: `${SOURCE}:tui:${Date.now()}:${requestSeq}`,
    method,
    params: {
      pane_id: paneId,
      source: SOURCE,
      seq: requestSeq,
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

export function createTabRenamer(send = request, initialTabID = process.env.HERDR_TAB_ID) {
  let tabId = initialTabID;

  return async (title) => {
    const label = title?.trim();
    if (!label || label === "Untitled") return;

    if (!tabId) {
      const response = await send("pane.get", { pane_id: process.env.HERDR_PANE_ID });
      tabId = response?.result?.pane?.tab_id;
    }
    if (tabId) await send("tab.rename", { tab_id: tabId, label });
  };
}

/**
 * Rename the tab whenever the selected root session, or its title, changes.
 *
 * A session with no title yet reports nothing, so the tab keeps its current
 * label until the real title lands rather than flashing a placeholder.
 */
export function createTitleSync(renameTab) {
  let selectedSessionID;
  let reportedTitle;

  return async (selection) => {
    const sessionID = selection?.sessionID;
    if (!sessionID) {
      selectedSessionID = undefined;
      reportedTitle = undefined;
      return;
    }
    if (sessionID !== selectedSessionID) {
      selectedSessionID = sessionID;
      reportedTitle = undefined;
    }
    const title = selection.title;
    if (!title || title === reportedTitle) return;
    reportedTitle = title;
    await renameTab(title);
  };
}

export function selectedRootSession(api) {
  const route = api.route.current;
  const sessionID = route?.name === "session" ? route.params?.sessionID : undefined;
  if (typeof sessionID !== "string" || !sessionID) return undefined;
  const session = api.state.session.get(sessionID);
  // Subagent sessions carry a parentID; only a root selection owns the tab.
  if (!session || session.parentID) return undefined;
  return { sessionID, title: session.title };
}

export function createHerdrTuiTitlePlugin(send = request) {
  return {
    id: "herdr.opencode.session-title",
    tui: async (api) => {
      if (
        process.env.HERDR_ENV !== "1"
        || !process.env.HERDR_SOCKET_PATH
        || !process.env.HERDR_PANE_ID
      ) {
        return;
      }

      const syncTitle = createTitleSync(createTabRenamer(send));
      const fail = (error) => console.error("Herdr session-title rename failed", error);
      const poll = () => void syncTitle(selectedRootSession(api)).catch(fail);
      poll();
      const timer = setInterval(poll, ROUTE_POLL_INTERVAL_MS);
      api.lifecycle.onDispose(() => clearInterval(timer));
    },
  };
}

export default createHerdrTuiTitlePlugin();
