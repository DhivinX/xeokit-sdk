import type {GeometryArrays} from "./GeometryArrays";
import {apply} from "@xeokit/utils";
import {normalizeVec3, subVec3} from "@xeokit/matrix";
import {TrianglesPrimitive} from "@xeokit/constants";


/**
 * Creates a torus-shaped {@link @xeokit/scene!GeometryBucketHandle}.
 *
 * ## Usage
 * Creating a {@link @xeokit/scene!Mesh} with a torus-shaped {@link @xeokit/scene!GeometryBucketHandle} :
 *
 * [[Run this example](http://xeokit.github.io/xeokit-sdk/examples/#geometry_builders_buildTorusGeometry)]
 *
 * ````javascript
 * import {Viewer, Mesh, buildTorusGeometry, GeometryBucketHandle, PhongMaterial, Texture} from "xeokit-viewer.es.js";
 *
 * const viewer = new Viewer({
 *      canvasId: "myView"
 * });
 *
 * viewer.camera.eye = [0, 0, 5];
 * viewer.camera.look = [0, 0, 0];
 * viewer.camera.up = [0, 1, 0];
 *
 * new Mesh(viewer.scene, {
 *      geometry: new GeometryBucketHandle(viewer.scene, buildTorusGeometry({
 *          center: [0,0,0],
 *          radius: 1.0,
 *          tube: 0.5,
 *          radialSegments: 32,
 *          tubeSegments: 24,
 *          arc: Math.PI * 2.0
 *      }),
 *      material: new PhongMaterial(viewer.scene, {
 *         diffuseMap: new Texture(viewer.scene, {
 *             src: "textures/diffuse/uvGrid2.jpg"
 *         })
 *      })
 * });
 * ````
 *
 * @function buildTorusGeometry
 * @param cfg Configs
 * @param [cfg.id] Optional ID for the {@link @xeokit/scene!GeometryBucketHandle}, unique among all components in the parent {@link @xeokit/scene!Scene}, generated automatically when omitted.
 * @param [cfg.center] 3D point indicating the center position.
 * @param [cfg.radius=1] The overall radius.
 * @param [cfg.tube=0.3] The tube radius.
 * @param [cfg.radialSegments=32] The number of radial segments.
 * @param [cfg.tubeSegments=24] The number of tubular segments.
 * @param [cfg.arc=Math.PI*0.5] The length of the arc in radians, where Math.PI*2 is a closed torus.
 * @returns {Object} Configuration for a {@link @xeokit/scene!GeometryBucketHandle} subtype.
 */
export function buildTorusGeometry(cfg: {
    tube?: number;
    arc?: number;
    center?: number[];
    radialSegments?: number;
    radius?: number;
    tubeSegments?: number
} = {
    radius: 0,
    tube: 0,
    radialSegments: 0,
    tubeSegments: 0,
    arc: 0,
    center: [0, 0, 0]
}): GeometryArrays {

    let radius = cfg.radius || 1;
    if (radius < 0) {
        console.error("negative radius not allowed - will invert");
        radius *= -1;
    }
    radius *= 0.5;

    let tube = cfg.tube || 0.3;
    if (tube < 0) {
        console.error("negative tube not allowed - will invert");
        tube *= -1;
    }

    let radialSegments = cfg.radialSegments || 32;
    if (radialSegments < 0) {
        console.error("negative radialSegments not allowed - will invert");
        radialSegments *= -1;
    }
    if (radialSegments < 4) {
        radialSegments = 4;
    }

    let tubeSegments = cfg.tubeSegments || 24;
    if (tubeSegments < 0) {
        console.error("negative tubeSegments not allowed - will invert");
        tubeSegments *= -1;
    }
    if (tubeSegments < 4) {
        tubeSegments = 4;
    }

    let arc = cfg.arc || Math.PI * 2;
    if (arc < 0) {
        console.warn("negative arc not allowed - will invert");
        arc *= -1;
    }
    if (arc > 360) {
        arc = 360;
    }

    const center = cfg.center;
    let centerX = center ? center[0] : 0;
    let centerY = center ? center[1] : 0;
    const centerZ = center ? center[2] : 0;

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    let u;
    let v;
    let x;
    let y;
    let z;
    let vec;

    let i;
    let j;

    for (j = 0; j <= tubeSegments; j++) {
        for (i = 0; i <= radialSegments; i++) {

            u = i / radialSegments * arc;
            v = 0.785398 + (j / tubeSegments * Math.PI * 2);

            centerX = radius * Math.cos(u);
            centerY = radius * Math.sin(u);

            x = (radius + tube * Math.cos(v)) * Math.cos(u);
            y = (radius + tube * Math.cos(v)) * Math.sin(u);
            z = tube * Math.sin(v);

            positions.push(x + centerX);
            positions.push(y + centerY);
            positions.push(z + centerZ);

            uvs.push(1 - (i / radialSegments));
            uvs.push((j / tubeSegments));

            vec = normalizeVec3(subVec3([x, y, z], [centerX, centerY, centerZ], []), []);

            normals.push(vec[0]);
            normals.push(vec[1]);
            normals.push(vec[2]);
        }
    }

    let a;
    let b;
    let c;
    let d;

    for (j = 1; j <= tubeSegments; j++) {
        for (i = 1; i <= radialSegments; i++) {

            a = (radialSegments + 1) * j + i - 1;
            b = (radialSegments + 1) * (j - 1) + i - 1;
            c = (radialSegments + 1) * (j - 1) + i;
            d = (radialSegments + 1) * j + i;

            indices.push(a);
            indices.push(b);
            indices.push(c);

            indices.push(c);
            indices.push(d);
            indices.push(a);
        }
    }

    return apply(cfg, {
        primitive:TrianglesPrimitive,
        positions: positions,
        normals: normals,
        uv: uvs,
        indices: indices
    });
}
