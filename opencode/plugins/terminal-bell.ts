import type { Plugin } from "@opencode-ai/plugin"

export const TerminalBell: Plugin = async ({ $, client }) => {
  const playSound = async () => {
    try {
      await $`paplay --volume=65536 /usr/share/sounds/freedesktop/stereo/message.oga`.quiet();
      await new Promise((resolve) => setTimeout(resolve, 350));
      await $`paplay --volume=65536 /usr/share/sounds/freedesktop/stereo/message.oga`.quiet();
      await $`paplay --volume=65536 /usr/share/sounds/freedesktop/stereo/message.oga`.quiet();
    } catch (err) {
      // Silently fail if audio system is busy
    }
  };

  return {
    event: async ({ event }) => {
      const eventType = event.type as string;

      // --- Finished a Task (Main Agent Only) ---
      if (eventType === "session.idle") {
        const sessionID = (event as any).properties?.sessionID;

        if (sessionID) {
          try {
            const { data, error } = await client.session.get({ path: { id: sessionID } });
            if (error || !data) return;

            // Silently exit if this is just a subagent finishing
            if ((data as any).parentID || (data as any).parent_id) {
              return;
            }
          } catch (err) {}
        }

        await playSound();
      }

      // --- Asking a Question / Permission ---
      if (eventType === "permission.asked" || eventType === "permission.updated") {
        await playSound();
      }
    }
  }
}
