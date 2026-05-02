import React from "react";
import { createRoot } from "react-dom/client";

import { Application } from "./components/Application";
import "./resources/fonts";

const container = document.querySelector("#root");
if (!container) throw new Error("missing #root element");

createRoot(container).render(<Application />);
