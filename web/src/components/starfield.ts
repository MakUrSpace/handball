/** Efficient, dependency-free A-Frame starfield shared by the app launcher and yoga. */

declare const AFRAME: any;
declare const THREE: any;

if (!AFRAME.components.starfield) {
  AFRAME.registerComponent('starfield', {
    schema: {
      count: { type: 'int', default: 1800 },
      radius: { type: 'number', default: 30 },
      depth: { type: 'number', default: 14 },
      drift: { type: 'number', default: 0.012 },
    },

    init: function () {
      const positions = new Float32Array(this.data.count * 3);
      const colors = new Float32Array(this.data.count * 3);
      const color = new THREE.Color();

      for (let i = 0; i < this.data.count; i++) {
        const distance = this.data.radius + Math.random() * this.data.depth;
        const theta = Math.random() * Math.PI * 2;
        const cosPhi = Math.random() * 2 - 1;
        const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
        const offset = i * 3;

        positions[offset] = distance * sinPhi * Math.cos(theta);
        positions[offset + 1] = distance * cosPhi;
        positions[offset + 2] = distance * sinPhi * Math.sin(theta);

        const temperature = Math.random();
        color.set(temperature > 0.82 ? '#b9d9ff' : temperature < 0.08 ? '#ffe5bd' : '#f7fbff');
        const brightness = 0.42 + Math.random() * 0.58;
        colors[offset] = color.r * brightness;
        colors[offset + 1] = color.g * brightness;
        colors[offset + 2] = color.b * brightness;
      }

      this.geometry = new THREE.BufferGeometry();
      this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      this.material = new THREE.PointsMaterial({
        size: 0.075,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.92,
        vertexColors: true,
        depthWrite: false,
      });
      this.points = new THREE.Points(this.geometry, this.material);
      this.el.object3D.add(this.points);
    },

    tick: function (time: number, delta: number) {
      if (!this.points) return;
      this.points.rotation.y += this.data.drift * Math.min(delta, 40) / 1000;
      this.material.opacity = 0.84 + Math.sin(time * 0.00031) * 0.08;
    },

    remove: function () {
      if (this.points) this.el.object3D.remove(this.points);
      this.geometry?.dispose();
      this.material?.dispose();
    },
  });
}
