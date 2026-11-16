// Raw Polaris camera dumps, JSON so the 2,841-entry bundle does not trip TS2590.
// ponytail: boundary types live in indonesia-cctv.ts; these are untyped dumps.
import type { PolarisCamera } from '@/lib/indonesia-cctv';

import bundle from './bundle.json';
import bandung from './bandung.json';
import banyuwangi from './banyuwangi.json';
import bojonegoro from './bojonegoro.json';
import depok from './depok.json';
import gresik from './gresik.json';
import malangkota from './malangkota.json';
import semarang from './semarang.json';

export const BUNDLE = (bundle as unknown) as PolarisCamera[];
export const BANDUNG = (bandung as unknown) as PolarisCamera[];
export const BANYUWANGI = (banyuwangi as unknown) as PolarisCamera[];
export const BOJONEGORO = (bojonegoro as unknown) as PolarisCamera[];
export const DEPOK = (depok as unknown) as PolarisCamera[];
export const GRESIK = (gresik as unknown) as PolarisCamera[];
export const MALANGKOTA = (malangkota as unknown) as PolarisCamera[];
export const SEMARANG = (semarang as unknown) as PolarisCamera[];
