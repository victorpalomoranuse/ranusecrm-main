import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { useGLTF, OrbitControls, Stage } from '@react-three/drei';
import './Model3D.css';

const MODEL_URL = 'https://guumqvvaalifyluxmidz.supabase.co/storage/v1/object/public/assets/modelo.glb';

function Model() {
  const { scene } = useGLTF(MODEL_URL);
  return <primitive object={scene} rotation={[0, -Math.PI / 1.4, 0]} scale={2.2} />;
}

function Fallback() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#beb0a2" />
    </mesh>
  );
}

export function Model3D() {
  return (
    <div className="model3d-wrap">
      <Canvas gl={{ antialias: true, alpha: true }}>
        <Suspense fallback={<Fallback />}>
          <Stage environment="city" intensity={0.6} adjustCamera={0.9}>
            <Model />
          </Stage>
          <OrbitControls
            enableZoom={false}
            enablePan={false}
            autoRotate={false}
            minPolarAngle={Math.PI / 4}
            maxPolarAngle={Math.PI / 1.8}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload(MODEL_URL);
