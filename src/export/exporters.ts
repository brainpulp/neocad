import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { buildExportScene } from './scene'
import { downloadBlob } from '../persistence/file'
import type { Document } from '../document/types'

function baseName(doc: Document): string {
  return doc.metadata.name || 'untitled'
}

/** One-way glTF export of the current posed geometry (for Blender / web viewers). */
export function exportGLTF(doc: Document): void {
  const scene = buildExportScene(doc)
  new GLTFExporter().parse(
    scene,
    (result) => {
      const blob =
        result instanceof ArrayBuffer
          ? new Blob([result], { type: 'model/gltf-binary' })
          : new Blob([JSON.stringify(result)], { type: 'model/gltf+json' })
      downloadBlob(blob, `${baseName(doc)}.gltf`)
    },
    (error) => console.error('glTF export failed', error),
    {},
  )
}

/** One-way STL export of the current posed geometry (for slicers / 3D printing). */
export function exportSTL(doc: Document): void {
  const scene = buildExportScene(doc)
  const stl = new STLExporter().parse(scene)
  downloadBlob(new Blob([stl], { type: 'model/stl' }), `${baseName(doc)}.stl`)
}
