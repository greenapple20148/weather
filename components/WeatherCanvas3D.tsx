
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface WeatherCanvas3DProps {
  code: number;
}

const WeatherCanvas3D: React.FC<WeatherCanvas3DProps> = ({ code }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // --- SETUP ---
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);

    camera.position.z = 5;

    // --- ATMOSPHERIC ELEMENTS ---
    const particlesGroup = new THREE.Group();
    scene.add(particlesGroup);

    const isSunny = code === 0 || code === 1;
    const isRainy = (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
    const isSnowy = code >= 71 && code <= 77;
    const isCloudy = code === 2 || code === 3;
    const isStormy = code >= 95;

    // Procedural Particle Creation
    const particleCount = isRainy ? 1500 : (isSnowy ? 800 : (isSunny ? 200 : 400));
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 15;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 15;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 10;
      velocities[i] = Math.random() * 0.1 + 0.05;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    let material;
    if (isRainy) {
      material = new THREE.PointsMaterial({ color: 0x3b82f6, size: 0.05, transparent: true, opacity: 0.6 });
    } else if (isSnowy) {
      material = new THREE.PointsMaterial({ color: 0xffffff, size: 0.1, transparent: true, opacity: 0.8 });
    } else {
      material = new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, transparent: true, opacity: 0.3 });
    }

    const points = new THREE.Points(geometry, material);
    particlesGroup.add(points);

    // Sun/Moon for Sunny/Clear
    let core: THREE.Mesh | null = null;
    if (isSunny) {
      const coreGeo = new THREE.SphereGeometry(1, 32, 32);
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
      core = new THREE.Mesh(coreGeo, coreMat);
      core.position.set(0, 0, -2);
      scene.add(core);

      const glowGeo = new THREE.SphereGeometry(1.5, 32, 32);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.2 });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      core.add(glow);
    }

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, isStormy ? 0.2 : 0.6);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0xffffff, 1);
    pointLight.position.set(5, 5, 5);
    scene.add(pointLight);

    // --- ANIMATION LOOP ---
    let frameId: number;
    let stormTick = 0;

    const animate = () => {
      frameId = requestAnimationFrame(animate);

      // Rain/Snow movement
      const posArray = geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < particleCount; i++) {
        if (isRainy) {
          posArray[i * 3 + 1] -= velocities[i] * 2; // Fast fall
        } else if (isSnowy) {
          posArray[i * 3 + 1] -= velocities[i] * 0.5; // Slow fall
          posArray[i * 3] += Math.sin(Date.now() * 0.001 + i) * 0.01; // Sway
        } else {
          posArray[i * 3 + 1] -= velocities[i] * 0.1; // Drift
        }

        if (posArray[i * 3 + 1] < -7) posArray[i * 3 + 1] = 7;
      }
      geometry.attributes.position.needsUpdate = true;

      // Sun pulsing
      if (core) {
        const pulse = Math.sin(Date.now() * 0.002) * 0.05 + 1;
        core.scale.set(pulse, pulse, pulse);
      }

      // Storm Lightning
      if (isStormy) {
        stormTick++;
        if (stormTick % 120 === 0 && Math.random() > 0.7) {
          renderer.setClearColor(0xffffff, 0.1);
          setTimeout(() => renderer.setClearColor(0x000000, 0), 50);
        }
      }

      particlesGroup.rotation.y += 0.001;
      renderer.render(scene, camera);
    };

    animate();

    // --- CLEANUP ---
    const handleResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameId);
      renderer.dispose();
      if (containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [code]);

  return <div ref={containerRef} className="absolute inset-0 z-0 pointer-events-none" />;
};

export default WeatherCanvas3D;
