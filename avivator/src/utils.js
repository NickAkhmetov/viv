import { useState, useEffect } from 'react';
import { fromBlob, fromFile, fromUrl } from 'geotiff';

import { loadOmeTiff, loadBioformatsZarr, getChannelStats } from '../../dist';

import { GLOBAL_SLIDER_DIMENSION_FIELDS, COLOR_PALLETE } from './constants';

const MAX_CHANNELS_FOR_SNACKBAR_WARNING = 40;

/**
 * Guesses whether string URL or File is for an OME-TIFF image.
 * @param {string | File} urlOrFile
 */
function isOMETIFF(urlOrFile) {
  if (Array.isArray(urlOrFile)) return false; // local Zarr is array of File Objects
  const name = typeof urlOrFile === 'string' ? urlOrFile : urlOrFile.name;
  return name.includes('ome.tiff') || name.includes('ome.tif');
}

class UnsupportedBrowserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedBrowserError';
  }
}

/**
 *
 * @param {string | File} src
 * @param {import('../../src/loaders/omexml').OMEXML[0]} imgMeta
 * @param {number} levels
 */
async function getTotalImageCount(src, imgMeta, levels) {
  const from = typeof src === 'string' ? fromUrl : fromBlob;
  const tiff = await from(src);
  const {
    Pixels: { SizeC, SizeT, SizeZ }
  } = imgMeta;
  const numImagesPerResolution = SizeC * SizeT * SizeZ;

  const firstImage = await tiff.getImage(0);
  const hasSubIFDs = Boolean(firstImage?.fileDirectory?.SubIFDs);
  return numImagesPerResolution * (hasSubIFDs ? 1 : levels);
}

/**
 * Given an image source, creates a PixelSource[] and returns XML-meta
 *
 * @param {string | File | File[]} urlOrFile
 * @param {} handleOffsetsNotFound
 * @param {*} handleLoaderError
 */
export async function createLoader(
  urlOrFile,
  handleOffsetsNotFound,
  handleLoaderError
) {
  // If the loader fails to load, handle the error (show an error snackbar).
  // Otherwise load.
  try {
    // OME-TIFF
    if (isOMETIFF(urlOrFile)) {
      if (urlOrFile instanceof File) {
        const source = await loadOmeTiff(urlOrFile);
        return source;
      }
      const url = urlOrFile;
      const res = await fetch(url.replace(/ome\.tif(f?)/gi, 'offsets.json'));
      const isOffsets404 = res.status === 404;
      const offsets = !isOffsets404 ? await res.json() : undefined;
      const source = await loadOmeTiff(urlOrFile, { offsets });

      // Show a warning if the total number of channels/images exceeds a fixed amount.
      // Non-Bioformats6 pyramids use Image tags for pyramid levels and do not have offsets
      // built in to the format for them, hence the ternary.
      const totalImageCount = await getTotalImageCount(
        urlOrFile,
        source.metadata,
        source.data.length
      );
      if (isOffsets404 && totalImageCount > MAX_CHANNELS_FOR_SNACKBAR_WARNING) {
        handleOffsetsNotFound(true);
      }
      return source;
    }
    // Bio-Formats Zarr
    if (
      Array.isArray(urlOrFile) &&
      typeof urlOrFile[0].arrayBuffer !== 'function'
    ) {
      throw new UnsupportedBrowserError(
        'Cannot upload a local Zarr with this browser. Try using Chrome, Firefox, or Microsoft Edge.'
      );
    }

    const source = await loadBioformatsZarr(urlOrFile);
    return source;
  } catch (e) {
    if (e instanceof UnsupportedBrowserError) {
      handleLoaderError(e.message);
    } else {
      handleLoaderError(null);
    }
    return { data: null };
  }
}

// Get the last part of a url (minus query parameters) to be used
// as a display name for avivator.
export function getNameFromUrl(url) {
  return url.split('?')[0].split('/').slice(-1)[0];
}

/**
 * Return the midpoint of the global dimensions as a default selection.
 *
 * @param { import('../../src/types').PixelSource<['t', 'z', 'c']> } pixelSource
 */
function getDefaultGlobalSelection({ labels, shape }) {
  const dims = labels
    .map((name, i) => [name, i])
    .filter(d => GLOBAL_SLIDER_DIMENSION_FIELDS.includes(d[0]));

  /**
   * @type { { t: number, z: number, c: number  } }
   */
  const selection = {};
  dims.forEach(([name, index]) => {
    selection[name] = Math.floor((shape[index] || 0) / 2);
  });

  return selection;
}

/**
 * @param {Array.<number>} shape loader shape
 */
export function isInterleaved(shape) {
  const lastDimSize = shape[shape.length - 1];
  return lastDimSize === 3 || lastDimSize === 4;
}

// Create a default selection using the midpoint of the available global dimensions,
// and then the first four available selections from the first selectable channel.
/**
 *
 * @param { import('../../src/types').PixelSource<['t', 'z', 'c']> } pixelSource
 */
export function buildDefaultSelection(pixelSource) {
  let selection = [];
  const globalSelection = getDefaultGlobalSelection(pixelSource);
  // First non-global dimension with some sort of selectable values.

  const firstNonGlobalDimension = pixelSource.labels
    .map((name, i) => ({ name, size: pixelSource.shape[i] }))
    .find(d => !GLOBAL_SLIDER_DIMENSION_FIELDS.includes(d.name) && d.size);

  for (let i = 0; i < Math.min(4, firstNonGlobalDimension.size); i += 1) {
    selection.push({
      [firstNonGlobalDimension.name]: i,
      ...globalSelection
    });
  }

  selection = isInterleaved(pixelSource.shape)
    ? [{ ...selection[0], c: 0 }]
    : selection;
  return selection;
}

export function hexToRgb(hex) {
  // https://stackoverflow.com/questions/5623838/rgb-to-hex-and-hex-to-rgb
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result.map(d => parseInt(d, 16)).slice(1);
}

export function range(length) {
  return [...Array(length).keys()];
}

export function useWindowSize(scaleWidth = 1, scaleHeight = 1) {
  function getSize() {
    return {
      width: window.innerWidth * scaleWidth,
      height: window.innerHeight * scaleHeight
    };
  }
  const [windowSize, setWindowSize] = useState(getSize());
  useEffect(() => {
    const handleResize = () => {
      setWindowSize(getSize());
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  });
  return windowSize;
}

export function channelsReducer(state, { index, value, type }) {
  switch (type) {
    case 'CHANGE_CHANNEL': {
      // Changes name and selection for channel by index
      const { selection, domain, slider } = value;
      const selections = [...state.selections];
      selections[index] = selection;
      const domains = [...state.domains];
      domains[index] = domain;
      const sliders = [...state.sliders];
      sliders[index] = slider;
      return { ...state, selections, domains, sliders };
    }
    case 'CHANGE_COLOR': {
      // Changes color for individual channel by index
      const colors = [...state.colors];
      colors[index] = value;
      return { ...state, colors };
    }
    case 'CHANGE_SLIDER': {
      // Changes slider for individual channel by index
      const sliders = [...state.sliders];
      sliders[index] = value;
      return { ...state, sliders };
    }
    case 'CHANGE_DOMAIN': {
      // Changes slider for individual channel by index
      const domains = [...state.domains];
      domains[index] = value;
      return { ...state, domains };
    }
    case 'TOGGLE_ON': {
      // Toggles invidiual channel on and off by index
      const isOn = [...state.isOn];
      isOn[index] = !isOn[index];
      return { ...state, isOn };
    }
    case 'ADD_CHANNEL': {
      // Adds an additional channel
      const { selection, domain, slider } = value;
      const selections = [...state.selections, selection];
      const colors = [...state.colors, [255, 255, 255]];
      const isOn = [...state.isOn, true];
      const sliders = [...state.sliders, slider];
      const ids = [...state.ids, String(Math.random())];
      const domains = [...state.domains, domain];
      return { selections, domains, colors, isOn, sliders, ids };
    }
    case 'REMOVE_CHANNEL': {
      // Remove a single channel by index
      const sliders = state.sliders.filter((_, i) => i !== index);
      const colors = state.colors.filter((_, i) => i !== index);
      const isOn = state.isOn.filter((_, i) => i !== index);
      const ids = state.ids.filter((_, i) => i !== index);
      const selections = state.selections.filter((_, i) => i !== index);
      const domains = state.domains.filter((_, i) => i !== index);
      return { sliders, colors, isOn, ids, domains, selections };
    }
    case 'RESET_CHANNELS': {
      // Clears current channels and sets with new defaults
      const { selections, sliders, domains, colors, isOn } = value;
      const n = selections.length;
      return {
        selections,
        sliders,
        domains,
        colors: colors || selections.map((sel, i) => COLOR_PALLETE[i]),
        isOn: isOn || Array(n).fill(true),
        ids: range(n).map(() => String(Math.random()))
      };
    }
    default:
      throw new Error();
  }
}

export async function getSingleSelectionStats({ loader, selection }) {
  const data = Array.isArray(loader) ? loader[loader.length - 1] : loader;
  const raster = await data.getRaster({ selection });
  const selectionStats = getChannelStats(raster.data);
  const { domain, autoSliders: slider } = selectionStats;
  return { domain, slider };
}

export async function getSingleSelectionStats3D({ loader, selection }) {
  const lowResSource = loader[loader.length - 1];
  const { shape, labels } = lowResSource;
  const sizeZ = shape[labels.indexOf('z')] >> (loader.length - 1);
  const raster0 = await lowResSource.getRaster({
    selection: { ...selection, z: 0 }
  });
  const rasterMid = await lowResSource.getRaster({
    selection: { ...selection, z: Math.floor(sizeZ / 2) }
  });
  const rasterTop = await lowResSource.getRaster({
    selection: { ...selection, z: sizeZ - 1 }
  });
  const stats0 = getChannelStats(raster0.data);
  const statsMid = getChannelStats(rasterMid.data);
  const statsTop = getChannelStats(rasterTop.data);
  return {
    domain: [
      Math.min(stats0.domain[0], statsMid.domain[0], statsTop.domain[0]),
      Math.max(stats0.domain[1], statsMid.domain[1], statsTop.domain[1])
    ],
    slider: [
      Math.min(
        stats0.autoSliders[0],
        statsMid.autoSliders[0],
        statsTop.autoSliders[0]
      ),
      Math.max(
        stats0.autoSliders[1],
        statsMid.autoSliders[1],
        statsTop.autoSliders[1]
      )
    ]
  };
}

/* eslint-disable no-useless-escape */
// https://stackoverflow.com/a/11381730
export function isMobileOrTablet() {
  let check = false;
  // eslint-disable-next-line func-names
  (function (a) {
    if (
      /(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino|android|ipad|playbook|silk/i.test(
        a
      ) ||
      /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(
        a.substr(0, 4)
      )
    )
      check = true;
  })(navigator.userAgent || navigator.vendor || window.opera);
  return check;
}
/* eslint-disable no-useless-escape */

/**
 * @param { import('../../src/loaders/omexml').OMEXML[0] } imgMeta
 */
export function guessRgb({ Pixels }) {
  const numChannels = Pixels.Channels.length;
  const { SamplesPerPixel } = Pixels.Channels[0];

  const is3Channel8Bit = numChannels === 3 && Pixels.Type === 'uint8';
  const interleavedRgb =
    Pixels.SizeC === 3 && numChannels === 1 && Pixels.Interleaved;

  return SamplesPerPixel === 3 || is3Channel8Bit || interleavedRgb;
}
