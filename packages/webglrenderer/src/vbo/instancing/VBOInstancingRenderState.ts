import {WebGLArrayBuf} from "@xeokit/webglutils";
import {FloatArrayParam} from "@xeokit/math";
import {SceneGeometry} from "@xeokit/scene";

/**
 * @private
 */
export interface VBOInstancingRenderState {
    numEdgeIndices: number;
    numIndices: number;
    obb: FloatArrayParam;
    sceneGeometry: SceneGeometry;
    uvDecodeMatrix: FloatArrayParam;
    colorTextureSupported: boolean;
    uvBuf: WebGLArrayBuf;
    metallicRoughnessBuf: WebGLArrayBuf;
    textureSet: any;
    normalsBuf: WebGLArrayBuf;
    edgeIndicesBuf: WebGLArrayBuf;
    numVertices: number;
    pickColorsBuf: WebGLArrayBuf;
    positionsDecodeMatrix: FloatArrayParam;
    offsetsBuf: WebGLArrayBuf;
    colorsBuf: WebGLArrayBuf;
    flagsBuf: WebGLArrayBuf;
    origin: FloatArrayParam;
    positionsBuf: WebGLArrayBuf;
    indicesBuf: WebGLArrayBuf;
    modelMatrixBuf: WebGLArrayBuf;
    modelMatrixCol0Buf: WebGLArrayBuf;
    modelMatrixCol1Buf: WebGLArrayBuf;
    modelMatrixCol2Buf: WebGLArrayBuf;
    modelNormalMatrixCol0Buf: WebGLArrayBuf;
    modelNormalMatrixCol1Buf: WebGLArrayBuf;
    modelNormalMatrixCol2Buf: WebGLArrayBuf;

    pbrSupported: boolean;
    numInstances: number;


}