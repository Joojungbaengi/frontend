export function setDepthDebug(
  root: ParentNode,
  text: string,
) {
  const el = root.querySelector("#depth-debug");

  if (el) {
    el.textContent = text;
  }
}