import type { GeoTIFFImage } from 'geotiff';
import quickselect from 'quickselect';
import type { OMEXML } from './omexml';
import type { TypedArray } from 'zarr';
import type { Labels, PixelSource } from '@vivjs/types';

export const DTYPE_LOOKUP = {
  uint8: 'Uint8',
  uint16: 'Uint16',
  uint32: 'Uint32',
  float: 'Float32',
  double: 'Float64',
  int8: 'Int8',
  int16: 'Int16',
  int32: 'Int32'
} as const;

/**
 * Computes statics from pixel data.
 *
 * This is helpful for generating histograms
 * or scaling contrastLimits to reasonable range. Also provided are
 * "contrastLimits" which are slider bounds that should give a
 * good initial image.
 * @param {TypedArray} arr
 * @return {{ mean: number, sd: number, q1: number, q3: number, median: number, domain: number[], contrastLimits: number[] }}
 */
export function getChannelStats(arr: TypedArray) {
  let len = arr.length;
  let min = Infinity;
  let max = -Infinity;
  let total = 0;
  // Range (min/max).
  // eslint-disable-next-line no-plusplus
  while (len--) {
    if (arr[len] < min) {
      min = arr[len];
    }
    if (arr[len] > max) {
      max = arr[len];
    }
    total += arr[len];
  }

  // Mean.
  const mean = total / arr.length;

  // Standard Deviation.
  len = arr.length;
  let sumSquared = 0;
  // eslint-disable-next-line no-plusplus
  while (len--) {
    sumSquared += (arr[len] - mean) ** 2;
  }
  const sd = (sumSquared / arr.length) ** 0.5;

  // Median, and quartiles via quickselect: https://en.wikipedia.org/wiki/Quickselect.
  // Odd number lengths should round down the index.
  const mid = Math.floor(arr.length / 2);
  const firstQuartileLocation = Math.floor(arr.length / 4);
  const thirdQuartileLocation = 3 * Math.floor(arr.length / 4);

  quickselect(arr, mid);
  const median = arr[mid];
  quickselect(arr, firstQuartileLocation, 0, mid);
  const q1 = arr[firstQuartileLocation];
  quickselect(arr, thirdQuartileLocation, mid, arr.length - 1);
  const q3 = arr[thirdQuartileLocation];

  // Used for "auto" settings.  This is the best parameter I've found experimentally.
  // I don't think there is a right answer and this feature is common in Fiji.
  // Also it's best to use a non-zero array for this.
  const cutoffArr = arr.filter((i: number) => i > 0);
  const cutoffPercentile = 0.0005;
  const topCutoffLocation = Math.floor(
    cutoffArr.length * (1 - cutoffPercentile)
  );
  const bottomCutoffLocation = Math.floor(cutoffArr.length * cutoffPercentile);
  quickselect(cutoffArr, topCutoffLocation);
  quickselect(cutoffArr, bottomCutoffLocation, 0, topCutoffLocation);
  const contrastLimits = [
    cutoffArr[bottomCutoffLocation] || 0,
    cutoffArr[topCutoffLocation] || 0
  ];
  return {
    mean,
    sd,
    q1,
    q3,
    median,
    domain: [min, max],
    contrastLimits
  };
}

export function ensureArray<T>(x: T | T[]) {
  return Array.isArray(x) ? x : [x];
}

/*
 * Converts 32-bit integer color representation to RGBA tuple.
 * Used to serialize colors from OME-XML metadata.
 *
 * > console.log(intToRgba(100100));
 * > // [0, 1, 135, 4]
 */
export function intToRgba(int: number) {
  if (!Number.isInteger(int)) {
    throw Error('Not an integer.');
  }

  // Write number to int32 representation (4 bytes).
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setInt32(0, int, false); // offset === 0, littleEndian === false

  // Take u8 view and extract number for each byte (1 byte for R/G/B/A).
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes) as [number, number, number, number];
}

/*
 * Helper method to determine whether pixel data is interleaved or not.
 * > isInterleaved([1, 24, 24]) === false;
 * > isInterleaved([1, 24, 24, 3]) === true;
 */
export function isInterleaved(shape: number[]) {
  const lastDimSize = shape[shape.length - 1];
  return lastDimSize === 3 || lastDimSize === 4;
}

/*
 * Creates typed labels from DimensionOrder.
 * > imgMeta.Pixels.DimensionOrder === 'XYCZT'
 * > getLabels(imgMeta.Pixels) === ['t', 'z', 'c', 'y', 'x']
 */
type Sel<Dim extends string> =
  Dim extends `${infer Z}${infer X}${infer A}${infer B}${infer C}`
    ? [C, B, A]
    : 'error';
export function getLabels(dimOrder: OMEXML[0]['Pixels']['DimensionOrder']) {
  return dimOrder.toLowerCase().split('').reverse() as Labels<
    Sel<Lowercase<typeof dimOrder>>
  >;
}

/*
 * Creates an ES6 map of 'label' -> index
 * > const labels = ['a', 'b', 'c', 'd'];
 * > const dims = getDims(labels);
 * > dims('a') === 0;
 * > dims('b') === 1;
 * > dims('c') === 2;
 * > dims('hi!'); // throws
 */
export function getDims<S extends string>(labels: S[]) {
  const lookup = new Map(labels.map((name, i) => [name, i]));
  if (lookup.size !== labels.length) {
    throw Error('Labels must be unique, found duplicated label.');
  }
  return (name: S) => {
    const index = lookup.get(name);
    if (index === undefined) {
      throw Error('Invalid dimension.');
    }
    return index;
  };
}

export function getImageSize<T extends string[]>(source: PixelSource<T>) {
  const interleaved = isInterleaved(source.shape);
  const [height, width] = source.shape.slice(interleaved ? -3 : -2);
  return { height, width };
}

export function prevPowerOf2(x: number) {
  return 2 ** Math.floor(Math.log2(x));
}

export const SIGNAL_ABORTED = '__vivSignalAborted';

export function guessTiffTileSize(image: GeoTIFFImage) {
  const tileWidth = image.getTileWidth();
  const tileHeight = image.getTileHeight();
  const size = Math.min(tileWidth, tileHeight);
  // deck.gl requirement for power-of-two tile size.
  return prevPowerOf2(size);
}

function convertString(value: string): string | number | boolean {
  // Attempt to convert to number
  const numValue = parseFloat(value);
  if (!isNaN(numValue)) {
    return numValue;
  }
  // Attempt to convert to boolean
  if (value.toLowerCase() === 'true') {
    return true;
  } else if (value.toLowerCase() === 'false') {
    return false;
  }
  // Default to string
  return value;
}

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === 1;
}

function isText(node: Node): node is Text {
  return node.nodeType === 3;
}

type JsonValue =
  | string
  | number
  | boolean
  | { [x: string]: JsonValue }
  | Array<JsonValue>;

function xmlToJson(
  xmlNode: HTMLElement,
  options: { attrNodeName: string }
): JsonValue | string | number | boolean {
  if (isText(xmlNode)) {
    // If the node is a text node
    return convertString(xmlNode.nodeValue?.trim() ?? '');
  }

  // If the node has no attributes and no children, return an empty string
  if (
    xmlNode.childNodes.length === 0 &&
    (!xmlNode.attributes || xmlNode.attributes.length === 0)
  ) {
    return '';
  }

  const jsonObj: JsonValue = {};

  if (xmlNode.attributes && xmlNode.attributes.length > 0) {
    const attrsObj: Record<string, string | boolean | number> = {};
    for (let i = 0; i < xmlNode.attributes.length; i++) {
      const attr = xmlNode.attributes[i];
      attrsObj[attr.name] = convertString(attr.value);
    }
    jsonObj[options.attrNodeName] = attrsObj;
  }

  for (let i = 0; i < xmlNode.childNodes.length; i++) {
    const childNode = xmlNode.childNodes[i];
    if (!isElement(childNode)) {
      throw new Error('Unexpected child node type');
    }
    const childJson = xmlToJson(childNode, options);
    if (childJson !== undefined && childJson !== '') {
      if (childNode.nodeName === '#text' && xmlNode.childNodes.length === 1) {
        return childJson;
      }
      if (jsonObj[childNode.nodeName]) {
        if (!Array.isArray(jsonObj[childNode.nodeName])) {
          jsonObj[childNode.nodeName] = [jsonObj[childNode.nodeName]];
        }
        (jsonObj[childNode.nodeName] as JsonValue[]).push(childJson);
      } else {
        jsonObj[childNode.nodeName] = childJson;
      }
    }
  }

  return jsonObj;
}

export function parseXML(xmlStr: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlStr, 'application/xml');
  return xmlToJson(doc.documentElement, { attrNodeName: 'attr' });
}
