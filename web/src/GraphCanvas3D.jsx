import React, { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import { Crosshair, RefreshCw } from "lucide-react";

const kindColors = {
  Concept: "#2f6f67",
  Person: "#955f2f",
  Project: "#335c8a",
  Document: "#6b5a8f",
  Technology: "#2f5f88",
  Infrastructure: "#7a4d3b",
  Model: "#4e6f38",
  Roadmap: "#8b4f67",
  System: "#2f6f67",
  ArchitectureLayer: "#335c8a",
  Component: "#6b5a8f",
  KnowledgeSpace: "#4f7f73",
  DataObject: "#7a6b38",
  Axiom: "#b58a4a",
  PublicFact: "#3f7f9a",
  Hypothesis: "#9a5f7d",
  Observation: "#4f7f73"
};

const kindLabels = {
  Concept: "概念",
  Person: "人物",
  Organization: "组织",
  Project: "项目",
  Document: "文档",
  Technology: "技术",
  Infrastructure: "基础设施",
  Model: "模型",
  Method: "方法",
  Process: "过程",
  Event: "事件",
  Institution: "制度",
  Roadmap: "路线图",
  System: "系统",
  ArchitectureLayer: "架构层",
  Component: "组件",
  KnowledgeSpace: "知识空间",
  DataObject: "数据对象"
};

function createNodeObject(node, active, connected) {
  const color = kindColors[node.kind] || "#64706b";
  const group = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(active ? 7.5 : 5.7, 24, 24),
    new THREE.MeshStandardMaterial({
      color,
      emissive: active ? color : "#000000",
      emissiveIntensity: active ? 0.42 : 0,
      roughness: 0.34,
      metalness: 0.18,
      transparent: true,
      opacity: connected || active ? 1 : 0.52
    })
  );
  group.add(sphere);

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  context.font = "600 34px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = active ? "#ffffff" : connected ? "#e8efec" : "#8c9893";
  context.fillText(node.title.length > 18 ? `${node.title.slice(0, 17)}…` : node.title, 256, 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  label.position.set(0, -11, 0);
  label.scale.set(44, 8.25, 1);
  label.renderOrder = 2;
  group.add(label);
  return group;
}

export default function GraphCanvas3D({ nodes, links, selectedId, onSelect }) {
  const containerRef = useRef(null);
  const graphRef = useRef(null);
  const objectCache = useRef(new Map());
  const [size, setSize] = useState({ width: 800, height: 680 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.max(320, Math.floor(entry.contentRect.width)),
        height: Math.max(520, Math.floor(entry.contentRect.height))
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const connectedIds = useMemo(() => {
    const ids = new Set(selectedId ? [selectedId] : []);
    links.forEach((link) => {
      if (link.sourceId === selectedId) ids.add(link.targetId);
      if (link.targetId === selectedId) ids.add(link.sourceId);
    });
    return ids;
  }, [links, selectedId]);

  const selectedLinks = useMemo(
    () => new Set(links.filter((link) => link.sourceId === selectedId || link.targetId === selectedId).map((link) => link.id)),
    [links, selectedId]
  );

  const graphData = useMemo(() => ({
    nodes: nodes.map((node) => ({ ...node })),
    links: links.map((link) => ({ ...link, source: link.sourceId, target: link.targetId }))
  }), [nodes, links]);

  function focusNode(node) {
    onSelect(node.id);
    const distance = Math.hypot(node.x || 0, node.y || 0, node.z || 0);
    const ratio = 1 + 90 / Math.max(distance, 1);
    graphRef.current?.cameraPosition(
      distance < 1
        ? { x: 0, y: 0, z: 90 }
        : { x: node.x * ratio, y: node.y * ratio, z: node.z * ratio },
      node,
      700
    );
  }

  return (
    <div ref={containerRef} className="graph-canvas" role="img" aria-label="三维知识图谱">
      <div className="graph-controls">
        <button type="button" title="聚焦全部节点" onClick={() => graphRef.current?.zoomToFit(650, 70)}>
          <Crosshair size={16} />
        </button>
        <button type="button" title="重新计算布局" onClick={() => graphRef.current?.d3ReheatSimulation()}>
          <RefreshCw size={16} />
        </button>
      </div>
      <ForceGraph3D
        ref={graphRef}
        width={size.width}
        height={size.height}
        graphData={graphData}
        backgroundColor="#101614"
        showNavInfo={false}
        nodeThreeObject={(node) => {
          const active = node.id === selectedId;
          const connected = !selectedId || connectedIds.has(node.id);
          const key = `${node.id}:${active ? "active" : connected ? "connected" : "muted"}`;
          if (!objectCache.current.has(key)) {
            objectCache.current.set(key, createNodeObject(node, active, connected));
          }
          return objectCache.current.get(key);
        }}
        nodeLabel={(node) => `${kindLabels[node.kind] || node.kind || "实体"} · ${node.title}`}
        linkColor={(link) => selectedLinks.has(link.id) ? "#73b7a9" : "#52605b"}
        linkWidth={(link) => selectedLinks.has(link.id) ? 2.2 : 0.75}
        linkOpacity={0.72}
        linkDirectionalParticles={(link) => selectedLinks.has(link.id) ? 4 : 1}
        linkDirectionalParticleWidth={(link) => selectedLinks.has(link.id) ? 2.8 : 1.2}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleColor={() => "#d6a76d"}
        d3AlphaDecay={0.025}
        d3VelocityDecay={0.32}
        warmupTicks={80}
        cooldownTicks={240}
        onEngineStop={() => graphRef.current?.zoomToFit(500, size.width < 500 ? 65 : 110)}
        onNodeClick={focusNode}
      />
      <div className="graph-hint">拖动旋转 · 滚轮缩放 · 点击聚焦</div>
    </div>
  );
}
