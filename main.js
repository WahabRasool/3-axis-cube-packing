import { Color, DirectionalLight, HemisphereLight, InstancedMesh, MeshLambertMaterial, Object3D, OrthographicCamera, PCFSoftShadowMap, Quaternion, Scene, Vector3, WebGLRenderer } from "https://esm.sh/three@0.169.0";
import { RoundedBoxGeometry } from "https://esm.sh/three@0.169.0/examples/jsm/geometries/RoundedBoxGeometry.js";

const N = 6000;
const MIN_R = 0.003;
const MAX_R = 0.3;

//////// SETUP
const scene = new Scene();
scene.background = new Color(0.01, 0.01, 0.01);
let asp = innerWidth / innerHeight;
const camera = new OrthographicCamera(-asp, asp, 1, -1, -1, 1);
const renderer = new WebGLRenderer({ canvas });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;

//////// LIGHT
const ambient = new HemisphereLight(new Color(1, 0.6, 0.2), new Color(0.2, 0.6, 1), 3);
scene.add(ambient);
const light = new DirectionalLight(new Color(1, 0.9, 0.8), 3);
light.position.set(-1, 1, 1);
scene.add(light);
light.castShadow = true;
light.shadow.mapSize.width = 1024;
light.shadow.mapSize.height = 1024;
light.shadow.camera.near = 0;
light.shadow.camera.far = 4;
light.shadow.camera.left = -1;
light.shadow.camera.right = 1;
light.shadow.camera.top = -1;
light.shadow.camera.bottom = 1;
light.shadow.bias = -0.001;
light.shadow.intensity = 0.62;

//////// INSTANCED SPHERES
const mat = new MeshLambertMaterial();
const new_cubes = (r) => {
    const geom = new RoundedBoxGeometry(2, 2, 2, 1, r);
    const mesh = new InstancedMesh(geom, mat, N);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = 0;
    return mesh;
};
const cubes = [
    { num: 0, mesh: new_cubes(0.4) },
    { num: 0, mesh: new_cubes(0.08) },
    { num: 0, mesh: new_cubes(0.04) },
];
const obj = new Object3D;
obj.scale.multiplyScalar(0.618);
for (const i of cubes) obj.add(i.mesh);
scene.add(obj);
const qt = obj.quaternion;
const dummy = new Object3D();

const set_instances = (e) => {
    const { n, tests_n, data } = e.data;
    for (let i = 0; i < data.length; i += 4) {
        const x = data[i + 0];
        const y = data[i + 1];
        const z = data[i + 2];
        const r = data[i + 3];
        dummy.position.set(x, y, z);
        dummy.scale.setScalar(r);
        dummy.updateMatrix();
        const side_id = r > 0.01 ? r > 0.1 ? 2 : 1 : 0;
        const inst = cubes[side_id];
        const { mesh } = inst;
        mesh.setMatrixAt(inst.num, dummy.matrix);
        mesh.setColorAt(inst.num, new Color(random(0.1, 1.0), random(0.1, 0.9), random(0.1, 0.8)));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        mesh.count = ++inst.num;
    }
    log.textContent = `${str(n)} cubes\n${str(tests_n)} tests`;
};

//////// ANIMATION LOOP
const HPI = Math.PI / 2;
const DUR = 3000;
const DELAY = 1000;
const get_next_qt = (() => {
    const new_qt = (v, a) => new Quaternion().setFromAxisAngle(v, a);
    const vx = new Vector3(1, 0, 0);
    const qtxs = [new_qt(vx, -HPI), new_qt(vx, 0), new_qt(vx, HPI)];
    const vy = new Vector3(0, 1, 0);
    const qtys = [new_qt(vy, -HPI), new_qt(vy, 0), new_qt(vy, HPI)];
    let prev_qt_id = 5;
    const get_rnd_qt = () => {
        const id = (random(0, 3) << 2) + (random(0, 3) & 3);
        if (id === prev_qt_id || id === 5) return get_rnd_qt();
        prev_qt_id = id;
        return [qtxs[id >> 2], qtys[id & 3]];
    };
    return (prev_qt) => {
        const [xqt, yqt] = get_rnd_qt();
        return prev_qt.clone().premultiply(xqt).premultiply(yqt);
    };
})();
const ease = (t) => (35 * t ** 4 - 84 * t ** 5 + 70 * t ** 6 - 20 * t ** 7);
const rnd_rot = () => {
    const prev_qt = qt.clone();
    const next_qt = get_next_qt(prev_qt);
    const start = performance.now();
    const tick = () => {
        const now = performance.now();
        const t = ease(Math.min(1, (now - start) / DUR));
        qt.slerpQuaternions(prev_qt, next_qt, t);
        if (t < 1) requestAnimationFrame(tick);
        else setTimeout(rnd_rot, DELAY);
    };
    requestAnimationFrame(tick);
};
setTimeout(rnd_rot, DELAY);

//////// RENDER
renderer.setAnimationLoop(() => {
    renderer.render(scene, camera);
});

//////// PACKING WORKER
const worker_src = `
const N = ${N};
const MIN_R = ${MIN_R};
const MAX_R = ${MAX_R};

self.onmessage = function() {
    let n = 0;
    const packed = new Float32Array(N * 4);
    const N_PER_CHUNK = 20;
    let tests_n = 0;

    function rnd_pos() { return -1 + Math.random() * 2; }
    function dist3(x0, y0, z0, x1, y1, z1) {
        return Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2);
    }
    function get_radius(x, y, z, n) {
        let r = 1 - dist3(0, 0, 0, x, y, z);
        if (r < MIN_R) return 0;
        r = Math.min(Math.sqrt(r * r * 4 / 3) / 2, MAX_R);
        if (r < MIN_R) return 0;
        if (n === 0) return r;
        for (let i = 0; i < n * 4; i += 4) {
            const xo = packed[i];
            const yo = packed[i + 1];
            const zo = packed[i + 2];
            const ro = packed[i + 3];
            if (dist3(x, y, z, xo, yo, zo) < r + ro + MIN_R) {
                r = 0;
                break;
            }
        }
        return r;
    }

    while (n < N) {
        let x = 0, y = 0, z = 0, r = 0;
        while (r === 0) {
            x = rnd_pos();
            y = rnd_pos();
            z = rnd_pos();
            r = get_radius(x, y, z, n);
        }
        const i = n++ * 4;
        packed[i] = x;
        packed[i + 1] = y;
        packed[i + 2] = z;
        packed[i + 3] = r;

        if (n % N_PER_CHUNK === 0 || n === N) {
            // Create a new array to send this chunk
            const chunk = new Float32Array(packed.subarray(i - (N_PER_CHUNK - 1) * 4, i + 4));
            postMessage({ n, tests_n, data: chunk });
        }
    }
};
`;

const worker = new Worker(URL.createObjectURL(new Blob([worker_src], { type: "text/javascript" })));
worker.onmessage = set_instances;
worker.postMessage(1);


//////// UTILS
function str(num) { return num.toLocaleString(); }
function random(from = 0, to = 1) { return from + Math.random() * (to - from); }

onresize = () => {
    asp = innerWidth / innerHeight;
    camera.left = -asp;
    camera.right = asp;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
};
