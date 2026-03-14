import { useState } from "react";
import "./App.css";
import CustomMonacoEditor from "@/pages/query-sql";

function App() {
  const [inputEditorValue, setInputEditorValue] = useState("");

  return (
    <>
      <CustomMonacoEditor initialFirstLine="GET alias_org_attribute_info/_search" />
    </>
  );
}

export default App;
