import * as React from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RotateCcw } from "lucide-react";
import type { MachineStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Escritorio / cubículo en 3D con los equipos que tiene el puesto en este momento.
 * Se carga aparte (React.lazy) para que three.js solo se descargue al abrir un puesto.
 * - Arrastrar: girar · rueda o pellizco: acercar · clic en un equipo: abre su ficha.
 * - Lo que falta del kit básico se ve como un contorno vacío; lo que tiene falla o está en reparación, en rojo.
 */

export type DeskKind = "PC" | "LAPTOP" | "MONITOR" | "HEADSET" | "KEYBOARD" | "MOUSE" | "PHONE" | "OTHER";
export type DeskItem = { id: string; kind: DeskKind; label: string; status: MachineStatus; alert: boolean };

const BRAND = "#dc2626";
const STATUS_GLOW: Record<MachineStatus, string> = { ACTIVE: "#22c55e", STORAGE: "#94a3b8", REPAIR: "#f59e0b", TRANSIT: "#38bdf8", RETIRED: "#525252" };
/** Kit básico: si falta, se dibuja su contorno */
const BASIC: DeskKind[] = ["PC", "MONITOR", "HEADSET", "KEYBOARD", "MOUSE"];
const GHOST_LABEL: Record<DeskKind, string> = { PC: "Computadora", LAPTOP: "Laptop", MONITOR: "Monitor", HEADSET: "Headset", KEYBOARD: "Teclado", MOUSE: "Mouse", PHONE: "Teléfono", OTHER: "Otro" };

type Palette = { desk: string; edge: string; panel: string; frame: string; dark: string; floor: string; ghost: string };
const LIGHT: Palette = { desk: "#f4f4f5", edge: "#d4d4d8", panel: "#d4d4d8", frame: "#a1a1aa", dark: "#27272a", floor: "#e4e4e7", ghost: "#a1a1aa" };
const DARK: Palette = { desk: "#3f3f46", edge: "#27272a", panel: "#3f3f46", frame: "#52525b", dark: "#18181b", floor: "#27272a", ghost: "#71717a" };

function useDarkMode() {
  const [dark, setDark] = React.useState(() => document.documentElement.classList.contains("dark"));
  React.useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

const HOME = { position: [1.75, 1.55, 2.15] as const, target: [0, 0.78, 0] as const };

/** Controles de órbita de three.js (sin librerías extra). Renderiza solo cuando algo cambia. */
function Controls({ resetKey }: { resetKey: number }) {
  const { camera, gl, invalidate } = useThree();
  const ref = React.useRef<OrbitControls | null>(null);
  React.useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.target.set(...HOME.target);
    c.minDistance = 1.3;
    c.maxDistance = 4.5;
    c.maxPolarAngle = Math.PI / 2.05;
    c.enablePan = false;
    c.rotateSpeed = 0.8;
    c.update();
    // invalidate() sin argumentos: el evento no debe llegar como "frames"
    const onChange = () => invalidate();
    c.addEventListener("change", onChange);
    ref.current = c;
    return () => {
      c.removeEventListener("change", onChange);
      c.dispose();
    };
  }, [camera, gl, invalidate]);
  React.useEffect(() => {
    if (!resetKey || !ref.current) return;
    camera.position.set(...HOME.position);
    ref.current.target.set(...HOME.target);
    ref.current.update();
    invalidate();
  }, [resetKey, camera, invalidate]);
  return null;
}

type PartProps = { item?: DeskItem; hover: string | null; setHover: (id: string | null) => void; onOpen: (id: string) => void; p: Palette };

/** Material de un equipo: normal, resaltado al pasar el mouse, rojo si tiene falla, contorno si falta */
function Mat({ color, item, hover, ghost, p, emissive }: { color: string; item?: DeskItem; hover: string | null; ghost?: boolean; p: Palette; emissive?: string }) {
  if (ghost) return <meshBasicMaterial color={p.ghost} wireframe transparent opacity={0.45} />;
  const hot = item && hover === item.id;
  const alert = item?.alert;
  return (
    <meshStandardMaterial
      color={alert ? "#7f1d1d" : color}
      emissive={hot ? BRAND : alert ? BRAND : (emissive ?? "#000000")}
      emissiveIntensity={hot ? 0.45 : alert ? 0.35 : emissive ? 0.6 : 0}
      roughness={0.55}
      metalness={0.15}
    />
  );
}

/** Grupo clicable de un equipo */
function Part({ item, setHover, onOpen, children, position, rotation }: PartProps & { children: React.ReactNode; position: [number, number, number]; rotation?: [number, number, number] }) {
  const handlers = item
    ? {
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHover(item.id);
          document.body.style.cursor = "pointer";
        },
        onPointerOut: () => {
          setHover(null);
          document.body.style.cursor = "";
        },
        onClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onOpen(item.id);
        },
      }
    : {};
  return (
    <group position={position} rotation={rotation} {...handlers}>
      {children}
      {item?.alert && (
        <mesh position={[0, 0.42, 0]}>
          <octahedronGeometry args={[0.035]} />
          <meshStandardMaterial color={BRAND} emissive={BRAND} emissiveIntensity={0.8} />
        </mesh>
      )}
    </group>
  );
}

function Monitor(props: PartProps & { x: number; ghost?: boolean }) {
  const { item, p, ghost, hover, x } = props;
  const on = item?.status === "ACTIVE" && !item.alert;
  return (
    <Part {...props} position={[x, 0.76, -0.2]}>
      <mesh position={[0, 0.01, 0]}>
        <boxGeometry args={[0.2, 0.02, 0.14]} />
        <Mat color={p.dark} p={p} item={item} hover={hover} ghost={ghost} />
      </mesh>
      <mesh position={[0, 0.12, -0.02]}>
        <boxGeometry args={[0.04, 0.22, 0.03]} />
        <Mat color={p.dark} p={p} item={item} hover={hover} ghost={ghost} />
      </mesh>
      <mesh position={[0, 0.33, 0]}>
        <boxGeometry args={[0.58, 0.34, 0.03]} />
        <Mat color={p.dark} p={p} item={item} hover={hover} ghost={ghost} />
      </mesh>
      {!ghost && (
        <mesh position={[0, 0.335, 0.0155]}>
          <planeGeometry args={[0.54, 0.3]} />
          <meshStandardMaterial color={on ? "#0f172a" : "#09090b"} emissive={on ? "#1d4ed8" : "#000000"} emissiveIntensity={on ? 0.35 : 0} />
        </mesh>
      )}
    </Part>
  );
}

function Tower(props: PartProps & { ghost?: boolean }) {
  const { item, p, ghost, hover } = props;
  return (
    <Part {...props} position={[0.58, 0.23, -0.12]}>
      <mesh>
        <boxGeometry args={[0.2, 0.44, 0.42]} />
        <Mat color={p.dark} p={p} item={item} hover={hover} ghost={ghost} />
      </mesh>
      {!ghost && (
        <mesh position={[0, 0.15, 0.212]}>
          <circleGeometry args={[0.012, 16]} />
          <meshBasicMaterial color={item ? STATUS_GLOW[item.status] : p.ghost} />
        </mesh>
      )}
    </Part>
  );
}

function Laptop(props: PartProps) {
  const { item, p, hover } = props;
  return (
    <Part {...props} position={[-0.42, 0.76, 0.02]} rotation={[0, 0.35, 0]}>
      <mesh position={[0, 0.01, 0]}>
        <boxGeometry args={[0.34, 0.02, 0.24]} />
        <Mat color="#a1a1aa" p={p} item={item} hover={hover} />
      </mesh>
      <mesh position={[0, 0.12, -0.12]} rotation={[-0.25, 0, 0]}>
        <boxGeometry args={[0.34, 0.22, 0.012]} />
        <Mat color="#a1a1aa" p={p} item={item} hover={hover} emissive={item?.status === "ACTIVE" ? "#1d4ed8" : undefined} />
      </mesh>
    </Part>
  );
}

function Keyboard(props: PartProps & { ghost?: boolean }) {
  const { item, p, ghost, hover } = props;
  return (
    <Part {...props} position={[0, 0.775, 0.17]}>
      <mesh>
        <boxGeometry args={[0.44, 0.025, 0.14]} />
        <Mat color={p.dark} p={p} item={item} hover={hover} ghost={ghost} />
      </mesh>
    </Part>
  );
}

function Mouse(props: PartProps & { ghost?: boolean }) {
  const { item, p, ghost, hover } = props;
  return (
    <Part {...props} position={[0.32, 0.775, 0.19]}>
      <mesh scale={[0.8, 0.45, 1.15]}>
        <sphereGeometry args={[0.035, 20, 14]} />
        <Mat color={p.dark} p={p} item={item} hover={hover} ghost={ghost} />
      </mesh>
    </Part>
  );
}

function Headset(props: PartProps & { ghost?: boolean }) {
  const { item, p, ghost, hover } = props;
  return (
    <Part {...props} position={[0.52, 0.86, 0.12]} rotation={[0, -0.5, 0]}>
      <mesh rotation={[0, 0, 0]}>
        <torusGeometry args={[0.085, 0.011, 10, 28, Math.PI]} />
        <Mat color={p.dark} p={p} item={item} hover={hover} ghost={ghost} />
      </mesh>
      {[-0.085, 0.085].map((x) => (
        <mesh key={x} position={[x, -0.005, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.035, 0.035, 0.03, 20]} />
          <Mat color={ghost ? p.ghost : BRAND} p={p} item={item} hover={hover} ghost={ghost} />
        </mesh>
      ))}
      <mesh position={[-0.11, -0.04, 0.04]} rotation={[0.9, 0, 0.3]}>
        <cylinderGeometry args={[0.004, 0.004, 0.09, 6]} />
        <Mat color={p.dark} p={p} item={item} hover={hover} ghost={ghost} />
      </mesh>
    </Part>
  );
}

function Phone(props: PartProps) {
  const { item, p, hover } = props;
  return (
    <Part {...props} position={[-0.56, 0.78, 0.12]} rotation={[0, 0.3, 0]}>
      <mesh>
        <boxGeometry args={[0.16, 0.04, 0.18]} />
        <Mat color={p.dark} p={p} item={item} hover={hover} />
      </mesh>
      <mesh position={[-0.04, 0.035, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <capsuleGeometry args={[0.018, 0.12, 4, 10]} />
        <Mat color={p.dark} p={p} item={item} hover={hover} />
      </mesh>
    </Part>
  );
}

function Other(props: PartProps & { i: number }) {
  const { item, p, hover, i } = props;
  return (
    <Part {...props} position={[-0.25 + i * 0.16, 0.82, -0.3]}>
      <mesh>
        <boxGeometry args={[0.12, 0.12, 0.12]} />
        <Mat color="#71717a" p={p} item={item} hover={hover} />
      </mesh>
    </Part>
  );
}

/** Cubículo: escritorio, paneles divisorios, silla y piso */
function Cubicle({ p, occupied }: { p: Palette; occupied: boolean }) {
  return (
    <group>
      <mesh position={[0, -0.001, 0.1]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.6, 48]} />
        <meshStandardMaterial color={p.floor} roughness={1} />
      </mesh>
      {/* Escritorio */}
      <mesh position={[0, 0.74, 0]}>
        <boxGeometry args={[1.6, 0.04, 0.8]} />
        <meshStandardMaterial color={p.desk} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.719, 0.401]}>
        <boxGeometry args={[1.6, 0.042, 0.004]} />
        <meshStandardMaterial color={BRAND} />
      </mesh>
      {[-0.76, 0.76].map((x) => (
        <mesh key={x} position={[x, 0.36, 0]}>
          <boxGeometry args={[0.04, 0.72, 0.74]} />
          <meshStandardMaterial color={p.edge} />
        </mesh>
      ))}
      {/* Paneles del cubículo (translúcidos para ver adentro) */}
      <mesh position={[0, 0.62, -0.42]}>
        <boxGeometry args={[1.72, 1.24, 0.04]} />
        <meshStandardMaterial color={p.panel} transparent opacity={0.55} roughness={0.9} />
      </mesh>
      {[-0.86, 0.86].map((x) => (
        <mesh key={x} position={[x, 0.55, 0.0]}>
          <boxGeometry args={[0.04, 1.1, 0.86]} />
          <meshStandardMaterial color={p.panel} transparent opacity={0.35} roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, 1.245, -0.42]}>
        <boxGeometry args={[1.74, 0.02, 0.05]} />
        <meshStandardMaterial color={p.frame} />
      </mesh>
      {/* Silla */}
      <group position={[0, 0, 0.72]} rotation={[0, Math.PI, 0]}>
        <mesh position={[0, 0.46, 0]}>
          <boxGeometry args={[0.46, 0.06, 0.44]} />
          <meshStandardMaterial color={occupied ? "#3f3f46" : p.frame} />
        </mesh>
        <mesh position={[0, 0.78, 0.2]}>
          <boxGeometry args={[0.44, 0.56, 0.05]} />
          <meshStandardMaterial color={occupied ? "#3f3f46" : p.frame} />
        </mesh>
        <mesh position={[0, 0.22, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 0.44, 10]} />
          <meshStandardMaterial color="#71717a" metalness={0.6} />
        </mesh>
        <mesh position={[0, 0.03, 0]}>
          <cylinderGeometry args={[0.25, 0.25, 0.03, 5]} />
          <meshStandardMaterial color="#52525b" />
        </mesh>
      </group>
    </group>
  );
}

function Scene({ items, occupied, hover, setHover, onOpen, p, resetKey }: { items: DeskItem[]; occupied: boolean; hover: string | null; setHover: (id: string | null) => void; onOpen: (id: string) => void; p: Palette; resetKey: number }) {
  const of = (k: DeskKind) => items.filter((i) => i.kind === k);
  const monitors = of("MONITOR");
  const pcs = of("PC");
  const laptops = of("LAPTOP");
  const headsets = of("HEADSET");
  const keyboards = of("KEYBOARD");
  const mice = of("MOUSE");
  const phones = of("PHONE");
  const others = of("OTHER");
  const base = { hover, setHover, onOpen, p };
  const monX = monitors.length <= 1 ? [0] : monitors.length === 2 ? [-0.31, 0.31] : [-0.6, 0, 0.6];
  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[2.5, 4, 3]} intensity={1.4} />
      <directionalLight position={[-3, 2, -1]} intensity={0.35} />
      <Controls resetKey={resetKey} />
      <Cubicle p={p} occupied={occupied} />
      {monitors.length ? monitors.slice(0, 3).map((m, i) => <Monitor key={m.id} {...base} item={m} x={monX[i]!} />) : <Monitor {...base} x={0} ghost />}
      {pcs.length ? <Tower {...base} item={pcs[0]} /> : laptops.length ? null : <Tower {...base} ghost />}
      {laptops.slice(0, 1).map((m) => <Laptop key={m.id} {...base} item={m} />)}
      {keyboards.length ? <Keyboard {...base} item={keyboards[0]} /> : <Keyboard {...base} ghost />}
      {mice.length ? <Mouse {...base} item={mice[0]} /> : <Mouse {...base} ghost />}
      {headsets.length ? <Headset {...base} item={headsets[0]} /> : <Headset {...base} ghost />}
      {phones.slice(0, 1).map((m) => <Phone key={m.id} {...base} item={m} />)}
      {others.slice(0, 4).map((m, i) => <Other key={m.id} {...base} item={m} i={i} />)}
    </>
  );
}

export default function Desk3D({ items, occupied, onOpen, className }: { items: DeskItem[]; occupied: boolean; onOpen: (id: string) => void; className?: string }) {
  const dark = useDarkMode();
  const p = dark ? DARK : LIGHT;
  const [hover, setHover] = React.useState<string | null>(null);
  const [resetKey, setResetKey] = React.useState(0);
  const hovered = items.find((i) => i.id === hover);
  const present = new Set(items.map((i) => i.kind));
  const missing = BASIC.filter((k) => !present.has(k) && !(k === "PC" && present.has("LAPTOP")));
  React.useEffect(() => () => void (document.body.style.cursor = ""), []);
  return (
    // Altura fija: dentro de un grid con scroll, overflow-hidden dejaría que la fila se encoja
    <div className={cn("relative h-[300px] shrink-0 overflow-hidden rounded-xl border bg-gradient-to-b from-muted/60 to-background", className)}>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ position: [...HOME.position], fov: 38, near: 0.1, far: 30 }}
        gl={{ antialias: true, alpha: true }}
        style={{ height: "100%", touchAction: "none" }}
        onPointerMissed={() => setHover(null)}
      >
        <Scene items={items} occupied={occupied} hover={hover} setHover={setHover} onOpen={onOpen} p={p} resetKey={resetKey} />
      </Canvas>
      <button
        type="button"
        onClick={() => setResetKey((k) => k + 1)}
        className="absolute top-2 right-2 rounded-md border bg-background/80 p-1.5 text-muted-foreground backdrop-blur hover:text-foreground"
        aria-label="Volver a la vista inicial"
        title="Volver a la vista inicial"
      >
        <RotateCcw className="size-3.5" />
      </button>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-2 bg-gradient-to-t from-background/90 to-transparent px-3 pt-6 pb-2 text-xs">
        <span className={cn("font-medium", hovered?.alert && "text-brand")}>
          {hovered ? `${hovered.label}${hovered.alert ? " · con falla" : ""} — clic para ver su ficha` : "Arrastra para girar · rueda para acercar · clic en un equipo"}
        </span>
        {missing.length > 0 && <span className="text-muted-foreground">Falta: {missing.map((k) => GHOST_LABEL[k]).join(", ")}</span>}
      </div>
    </div>
  );
}
