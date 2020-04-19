import gardens from "gardens";

const manager = gardens.createManager("observatory");
export default manager;

export const vfs = manager.scope("VirtualFileSystem");
