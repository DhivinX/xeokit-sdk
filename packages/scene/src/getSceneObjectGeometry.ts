import type {SceneObject} from "./SceneObject";
import type {Mesh} from "./Mesh";
import {decompressPositions3} from "@xeokit/compression";
import {transformPositions3} from "@xeokit/matrix";
import type {FloatArrayParam} from "@xeokit/math";
import type {Geometry} from "./Geometry";
import type {GeometryBucket} from "./GeometryBucket";
import {LinesPrimitive, TrianglesPrimitive} from "@xeokit/constants";

/**
 * The {@link getSceneObjectGeometry} passes an instance of GeometryView to its callback
 * for each {@link @xeokit/scene!GeometryBucket} it visits. The GeometryView provides the SceneObject, Mesh, Geometry and
 * GeometryBucket at the current state of iteration, along with accessors through which the caller can
 * get various resources that the GeometryView lazy-computes on-demand, such as decompressed vertex positions, World-space
 * vertex positons, and decompressed vertex UV coordinates.
 */
export interface GeometryView {

    /**
     * The current {@link @xeokit/scene!SceneObject}.
     */
    object: SceneObject;

    /**
     * The current {@link @xeokit/scene!Mesh}.
     */
    mesh: Mesh;

    /**
     * The current {@link @xeokit/scene!Mesh | Mesh's} position in {@link @xeokit/scene!SceneModel.meshes | SceneObject.meshes}.
     */
    meshIndex: number;

    /**
     * The current {@link @xeokit/scene!Geometry}.
     */
    geometry: Geometry;

    /**
     * The current {@link @xeokit/scene!GeometryBucket}.
     */
    geometryBucket: GeometryBucket;

    /**
     * The current {@link @xeokit/scene!GeometryBucket | GeometryBucket's} position in {@link @xeokit/scene!Geometry.geometryBuckets | Geometry.geometryBuckets }.
     */
    geometryBucketIndex: number;

    /**
     * The total number of {@link @xeokit/scene!GeometryBucket | GeometryBuckets} within the current {@link @xeokit/scene!SceneObject}.
     */
    readonly totalGeometryBuckets: number;

    /**
     * The number of primitives in the current {@link @xeokit/scene!GeometryBucket}.
     */
    readonly numPrimitives: number;

    /**
     * The current 3D vertex positions, dequantized, as 32-bit floats.
     */
    readonly positionsDecompressed: FloatArrayParam;

    /**
     * The current 3D World-space vertex positions, dequantized and world-transformed, as 64-bit floats.
     */
    readonly positionsWorld: FloatArrayParam;

    /**
     * The current vertex UV coordinates, if any, dequantized to 32-bit floats.
     */
    readonly uvsDecompressed: FloatArrayParam;
}

class GeometryViewImpl {

    object: SceneObject | null;
    mesh: Mesh | null;
    meshIndex: number;
    geometry: Geometry | null;
    geometryBucket: GeometryBucket | null;
    geometryBucketIndex: number;
    #positionsDecompressed: Float32Array | null;
    #positionsWorld: Float64Array | null;

    constructor() {
        this.object = null;
        this.mesh = null;
        this.meshIndex = 0;
        this.geometry = null;
        this.geometryBucket = null;
        this.geometryBucketIndex = 0;
        this.#positionsDecompressed = null;
        this.#positionsWorld = null;
    }

    get totalGeometryBuckets() {
        let totalGeometryBuckets = 0;
        if (this.object) {
            for (let i = 0, len = this.object.meshes.length; i < len; i++) {
                totalGeometryBuckets += this.object.meshes[i].geometry.geometryBuckets.length;
            }
        }
        return totalGeometryBuckets;
    }

    get numPrimitives() {
        const primitiveType = (<Geometry>this.geometry).primitive;
        const elementsPerPrimitiveType = (primitiveType === TrianglesPrimitive ? 3 : (primitiveType === LinesPrimitive ? 2 : 1));
        return (<FloatArrayParam>(<GeometryBucket>this.geometryBucket).indices).length / elementsPerPrimitiveType;
    }

    get positionsDecompressed(): FloatArrayParam {
        if (!this.#positionsDecompressed) {
            this.#positionsDecompressed = new Float32Array((<GeometryBucket>this.geometryBucket).positionsCompressed.length);
            decompressPositions3((<GeometryBucket>this.geometryBucket).positionsCompressed, (<Geometry>this.geometry).positionsDecompressMatrix, this.#positionsDecompressed);
        }
        return this.#positionsDecompressed;
    }

    get positionsWorld(): FloatArrayParam {
        if (!this.#positionsWorld) {
            const positionsDecompressed = this.positionsDecompressed;
            this.#positionsWorld = new Float64Array(positionsDecompressed.length);
            transformPositions3(positionsDecompressed, (<Mesh>this.mesh).matrix, this.#positionsWorld);
        }
        return this.#positionsWorld;
    }

    get uvsDecompressed(): FloatArrayParam | null{
        return null;
    }

    reset() {
        this.#positionsDecompressed = null;
        this.#positionsWorld = null;
    }
}

const geometryView = new GeometryViewImpl();

/**
 * Gets the uncompressed, World-space geometry of each {@link @xeokit/scene!GeometryBucket} in each
 * {@link @xeokit/scene!Geometry} in each {@link @xeokit/scene!Mesh} in a {@link @xeokit/scene!SceneObject}.
 *
 * If the callback returns ````true````, then this method immediately stops iterating and also returns ````true````.
 *
 * @param sceneObject
 * @param withEachGeometry
 */
export function getSceneObjectGeometry(sceneObject: SceneObject, withEachGeometry: (geometryView: GeometryView) => boolean): boolean {
    geometryView.reset();
    geometryView.object = sceneObject;
    for (let i = 0, len = sceneObject.meshes.length; i < len; i++) {
        const mesh = sceneObject.meshes[i];
        geometryView.mesh = mesh;
        geometryView.meshIndex = i;
        const geometry = mesh.geometry;
        geometryView.geometry = geometry;
        for (let j = 0, lenj = geometry.geometryBuckets.length; j < lenj; j++) {
            geometryView.geometryBucket = geometry.geometryBuckets[j];
            geometryView.geometryBucketIndex = j;
            if (withEachGeometry(<GeometryView>geometryView)) {
                return true;
            }
        }
    }
    return false;
}
