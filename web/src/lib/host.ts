// "Reveal in <file manager>" only makes sense when the browser is on the host machine; over a
// tunnel/LAN the server's file manager is on a different box. Loopback ⇒ browser == host, so
// navigator also reports the host OS — pick the right label for it.
export const isLocalHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(location.hostname);

export const revealLabel = /Mac/i.test(navigator.userAgent) ? "Reveal in Finder"
  : /Win/i.test(navigator.userAgent) ? "Reveal in File Explorer"
  : "Reveal in File Manager";
