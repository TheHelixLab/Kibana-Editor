import KibanaTools from "./components/KibanaTools";
import "./App.css";

function App() {
  return (
    <div style={{ width: "100%", padding: 12, boxSizing: "border-box" }}>
      <KibanaTools height="calc(100vh - 24px)" buttonPosition="lineEnd" />
    </div>
  );
}

export default App;
