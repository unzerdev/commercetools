/**
 * Country flag SVGs keyed by ISO-3166 alpha-2 code, for the language selector (locale -> flag) and
 * the country restriction list in the payment-method settings modal.
 *
 * GENERATED from every `country-<alpha2>.svg` under `assets/images/flags` - one import per file,
 * turned into a `data:` URL by `svg-url-loader` exactly as `payment-logos.ts` does its method
 * artwork: the app makes no remote image request (CSP + SSRF), and no artwork is duplicated as
 * hand-pasted base64 in source, as the previous fourteen-country table was. COVERAGE IS TOTAL on
 * purpose - the countries and languages come from the merchant's own commercetools project, so any of
 * them may turn up, and a missing flag would leave a hole in a list the merchant reads by shape.
 *
 * The folder holds ONLY `country-<alpha2>.svg`: artwork no alpha-2 code can address (the Ascension /
 * Tristan da Cunha / UN flags the set shipped with) was removed, since nothing could ever look it
 * up. `test/assets/flags.spec.ts` holds both halves of that - every file has an entry, every entry
 * has a file - and that nothing unaddressable sits in the folder.
 *
 * After adding artwork, add its import + entry here: this is plain source, not a build artifact, and
 * the entries are one line each in alpha-2 order.
 */
import flagAd from './images/flags/country-ad.svg';
import flagAe from './images/flags/country-ae.svg';
import flagAf from './images/flags/country-af.svg';
import flagAg from './images/flags/country-ag.svg';
import flagAi from './images/flags/country-ai.svg';
import flagAl from './images/flags/country-al.svg';
import flagAm from './images/flags/country-am.svg';
import flagAo from './images/flags/country-ao.svg';
import flagAq from './images/flags/country-aq.svg';
import flagAr from './images/flags/country-ar.svg';
import flagAs from './images/flags/country-as.svg';
import flagAt from './images/flags/country-at.svg';
import flagAu from './images/flags/country-au.svg';
import flagAw from './images/flags/country-aw.svg';
import flagAx from './images/flags/country-ax.svg';
import flagAz from './images/flags/country-az.svg';
import flagBa from './images/flags/country-ba.svg';
import flagBb from './images/flags/country-bb.svg';
import flagBd from './images/flags/country-bd.svg';
import flagBe from './images/flags/country-be.svg';
import flagBf from './images/flags/country-bf.svg';
import flagBg from './images/flags/country-bg.svg';
import flagBh from './images/flags/country-bh.svg';
import flagBi from './images/flags/country-bi.svg';
import flagBj from './images/flags/country-bj.svg';
import flagBl from './images/flags/country-bl.svg';
import flagBm from './images/flags/country-bm.svg';
import flagBn from './images/flags/country-bn.svg';
import flagBo from './images/flags/country-bo.svg';
import flagBq from './images/flags/country-bq.svg';
import flagBr from './images/flags/country-br.svg';
import flagBs from './images/flags/country-bs.svg';
import flagBt from './images/flags/country-bt.svg';
import flagBv from './images/flags/country-bv.svg';
import flagBw from './images/flags/country-bw.svg';
import flagBy from './images/flags/country-by.svg';
import flagBz from './images/flags/country-bz.svg';
import flagCa from './images/flags/country-ca.svg';
import flagCc from './images/flags/country-cc.svg';
import flagCd from './images/flags/country-cd.svg';
import flagCf from './images/flags/country-cf.svg';
import flagCg from './images/flags/country-cg.svg';
import flagCh from './images/flags/country-ch.svg';
import flagCi from './images/flags/country-ci.svg';
import flagCk from './images/flags/country-ck.svg';
import flagCl from './images/flags/country-cl.svg';
import flagCm from './images/flags/country-cm.svg';
import flagCn from './images/flags/country-cn.svg';
import flagCo from './images/flags/country-co.svg';
import flagCp from './images/flags/country-cp.svg';
import flagCr from './images/flags/country-cr.svg';
import flagCu from './images/flags/country-cu.svg';
import flagCv from './images/flags/country-cv.svg';
import flagCw from './images/flags/country-cw.svg';
import flagCx from './images/flags/country-cx.svg';
import flagCy from './images/flags/country-cy.svg';
import flagCz from './images/flags/country-cz.svg';
import flagDe from './images/flags/country-de.svg';
import flagDg from './images/flags/country-dg.svg';
import flagDj from './images/flags/country-dj.svg';
import flagDk from './images/flags/country-dk.svg';
import flagDm from './images/flags/country-dm.svg';
import flagDo from './images/flags/country-do.svg';
import flagDz from './images/flags/country-dz.svg';
import flagEa from './images/flags/country-ea.svg';
import flagEc from './images/flags/country-ec.svg';
import flagEe from './images/flags/country-ee.svg';
import flagEg from './images/flags/country-eg.svg';
import flagEh from './images/flags/country-eh.svg';
import flagEr from './images/flags/country-er.svg';
import flagEs from './images/flags/country-es.svg';
import flagEt from './images/flags/country-et.svg';
import flagEu from './images/flags/country-eu.svg';
import flagFi from './images/flags/country-fi.svg';
import flagFj from './images/flags/country-fj.svg';
import flagFk from './images/flags/country-fk.svg';
import flagFm from './images/flags/country-fm.svg';
import flagFo from './images/flags/country-fo.svg';
import flagFr from './images/flags/country-fr.svg';
import flagGa from './images/flags/country-ga.svg';
import flagGb from './images/flags/country-gb.svg';
import flagGd from './images/flags/country-gd.svg';
import flagGe from './images/flags/country-ge.svg';
import flagGf from './images/flags/country-gf.svg';
import flagGg from './images/flags/country-gg.svg';
import flagGh from './images/flags/country-gh.svg';
import flagGi from './images/flags/country-gi.svg';
import flagGl from './images/flags/country-gl.svg';
import flagGm from './images/flags/country-gm.svg';
import flagGn from './images/flags/country-gn.svg';
import flagGp from './images/flags/country-gp.svg';
import flagGq from './images/flags/country-gq.svg';
import flagGr from './images/flags/country-gr.svg';
import flagGs from './images/flags/country-gs.svg';
import flagGt from './images/flags/country-gt.svg';
import flagGu from './images/flags/country-gu.svg';
import flagGw from './images/flags/country-gw.svg';
import flagGy from './images/flags/country-gy.svg';
import flagHk from './images/flags/country-hk.svg';
import flagHm from './images/flags/country-hm.svg';
import flagHn from './images/flags/country-hn.svg';
import flagHr from './images/flags/country-hr.svg';
import flagHt from './images/flags/country-ht.svg';
import flagHu from './images/flags/country-hu.svg';
import flagIc from './images/flags/country-ic.svg';
import flagId from './images/flags/country-id.svg';
import flagIe from './images/flags/country-ie.svg';
import flagIl from './images/flags/country-il.svg';
import flagIm from './images/flags/country-im.svg';
import flagIn from './images/flags/country-in.svg';
import flagIo from './images/flags/country-io.svg';
import flagIq from './images/flags/country-iq.svg';
import flagIr from './images/flags/country-ir.svg';
import flagIs from './images/flags/country-is.svg';
import flagIt from './images/flags/country-it.svg';
import flagJe from './images/flags/country-je.svg';
import flagJm from './images/flags/country-jm.svg';
import flagJo from './images/flags/country-jo.svg';
import flagJp from './images/flags/country-jp.svg';
import flagKe from './images/flags/country-ke.svg';
import flagKg from './images/flags/country-kg.svg';
import flagKh from './images/flags/country-kh.svg';
import flagKi from './images/flags/country-ki.svg';
import flagKm from './images/flags/country-km.svg';
import flagKn from './images/flags/country-kn.svg';
import flagKp from './images/flags/country-kp.svg';
import flagKr from './images/flags/country-kr.svg';
import flagKw from './images/flags/country-kw.svg';
import flagKy from './images/flags/country-ky.svg';
import flagKz from './images/flags/country-kz.svg';
import flagLa from './images/flags/country-la.svg';
import flagLb from './images/flags/country-lb.svg';
import flagLc from './images/flags/country-lc.svg';
import flagLi from './images/flags/country-li.svg';
import flagLk from './images/flags/country-lk.svg';
import flagLr from './images/flags/country-lr.svg';
import flagLs from './images/flags/country-ls.svg';
import flagLt from './images/flags/country-lt.svg';
import flagLu from './images/flags/country-lu.svg';
import flagLv from './images/flags/country-lv.svg';
import flagLy from './images/flags/country-ly.svg';
import flagMa from './images/flags/country-ma.svg';
import flagMc from './images/flags/country-mc.svg';
import flagMd from './images/flags/country-md.svg';
import flagMe from './images/flags/country-me.svg';
import flagMf from './images/flags/country-mf.svg';
import flagMg from './images/flags/country-mg.svg';
import flagMh from './images/flags/country-mh.svg';
import flagMk from './images/flags/country-mk.svg';
import flagMl from './images/flags/country-ml.svg';
import flagMm from './images/flags/country-mm.svg';
import flagMn from './images/flags/country-mn.svg';
import flagMo from './images/flags/country-mo.svg';
import flagMp from './images/flags/country-mp.svg';
import flagMq from './images/flags/country-mq.svg';
import flagMr from './images/flags/country-mr.svg';
import flagMs from './images/flags/country-ms.svg';
import flagMt from './images/flags/country-mt.svg';
import flagMu from './images/flags/country-mu.svg';
import flagMv from './images/flags/country-mv.svg';
import flagMw from './images/flags/country-mw.svg';
import flagMx from './images/flags/country-mx.svg';
import flagMy from './images/flags/country-my.svg';
import flagMz from './images/flags/country-mz.svg';
import flagNa from './images/flags/country-na.svg';
import flagNc from './images/flags/country-nc.svg';
import flagNe from './images/flags/country-ne.svg';
import flagNf from './images/flags/country-nf.svg';
import flagNg from './images/flags/country-ng.svg';
import flagNi from './images/flags/country-ni.svg';
import flagNl from './images/flags/country-nl.svg';
import flagNo from './images/flags/country-no.svg';
import flagNp from './images/flags/country-np.svg';
import flagNr from './images/flags/country-nr.svg';
import flagNu from './images/flags/country-nu.svg';
import flagNz from './images/flags/country-nz.svg';
import flagOm from './images/flags/country-om.svg';
import flagPa from './images/flags/country-pa.svg';
import flagPe from './images/flags/country-pe.svg';
import flagPf from './images/flags/country-pf.svg';
import flagPg from './images/flags/country-pg.svg';
import flagPh from './images/flags/country-ph.svg';
import flagPk from './images/flags/country-pk.svg';
import flagPl from './images/flags/country-pl.svg';
import flagPm from './images/flags/country-pm.svg';
import flagPn from './images/flags/country-pn.svg';
import flagPr from './images/flags/country-pr.svg';
import flagPs from './images/flags/country-ps.svg';
import flagPt from './images/flags/country-pt.svg';
import flagPw from './images/flags/country-pw.svg';
import flagPy from './images/flags/country-py.svg';
import flagQa from './images/flags/country-qa.svg';
import flagRe from './images/flags/country-re.svg';
import flagRo from './images/flags/country-ro.svg';
import flagRs from './images/flags/country-rs.svg';
import flagRu from './images/flags/country-ru.svg';
import flagRw from './images/flags/country-rw.svg';
import flagSa from './images/flags/country-sa.svg';
import flagSb from './images/flags/country-sb.svg';
import flagSc from './images/flags/country-sc.svg';
import flagSd from './images/flags/country-sd.svg';
import flagSe from './images/flags/country-se.svg';
import flagSg from './images/flags/country-sg.svg';
import flagSh from './images/flags/country-sh.svg';
import flagSi from './images/flags/country-si.svg';
import flagSj from './images/flags/country-sj.svg';
import flagSk from './images/flags/country-sk.svg';
import flagSl from './images/flags/country-sl.svg';
import flagSm from './images/flags/country-sm.svg';
import flagSn from './images/flags/country-sn.svg';
import flagSo from './images/flags/country-so.svg';
import flagSr from './images/flags/country-sr.svg';
import flagSs from './images/flags/country-ss.svg';
import flagSt from './images/flags/country-st.svg';
import flagSv from './images/flags/country-sv.svg';
import flagSx from './images/flags/country-sx.svg';
import flagSy from './images/flags/country-sy.svg';
import flagSz from './images/flags/country-sz.svg';
import flagTc from './images/flags/country-tc.svg';
import flagTd from './images/flags/country-td.svg';
import flagTf from './images/flags/country-tf.svg';
import flagTg from './images/flags/country-tg.svg';
import flagTh from './images/flags/country-th.svg';
import flagTj from './images/flags/country-tj.svg';
import flagTk from './images/flags/country-tk.svg';
import flagTl from './images/flags/country-tl.svg';
import flagTm from './images/flags/country-tm.svg';
import flagTn from './images/flags/country-tn.svg';
import flagTo from './images/flags/country-to.svg';
import flagTr from './images/flags/country-tr.svg';
import flagTt from './images/flags/country-tt.svg';
import flagTv from './images/flags/country-tv.svg';
import flagTw from './images/flags/country-tw.svg';
import flagTz from './images/flags/country-tz.svg';
import flagUa from './images/flags/country-ua.svg';
import flagUg from './images/flags/country-ug.svg';
import flagUk from './images/flags/country-uk.svg';
import flagUm from './images/flags/country-um.svg';
import flagUs from './images/flags/country-us.svg';
import flagUy from './images/flags/country-uy.svg';
import flagUz from './images/flags/country-uz.svg';
import flagVa from './images/flags/country-va.svg';
import flagVc from './images/flags/country-vc.svg';
import flagVe from './images/flags/country-ve.svg';
import flagVg from './images/flags/country-vg.svg';
import flagVi from './images/flags/country-vi.svg';
import flagVn from './images/flags/country-vn.svg';
import flagVu from './images/flags/country-vu.svg';
import flagWf from './images/flags/country-wf.svg';
import flagWs from './images/flags/country-ws.svg';
import flagXx from './images/flags/country-xx.svg';
import flagYe from './images/flags/country-ye.svg';
import flagYt from './images/flags/country-yt.svg';
import flagZa from './images/flags/country-za.svg';
import flagZm from './images/flags/country-zm.svg';
import flagZw from './images/flags/country-zw.svg';

export const flags: Record<string, string> = {
  AD: flagAd,
  AE: flagAe,
  AF: flagAf,
  AG: flagAg,
  AI: flagAi,
  AL: flagAl,
  AM: flagAm,
  AO: flagAo,
  AQ: flagAq,
  AR: flagAr,
  AS: flagAs,
  AT: flagAt,
  AU: flagAu,
  AW: flagAw,
  AX: flagAx,
  AZ: flagAz,
  BA: flagBa,
  BB: flagBb,
  BD: flagBd,
  BE: flagBe,
  BF: flagBf,
  BG: flagBg,
  BH: flagBh,
  BI: flagBi,
  BJ: flagBj,
  BL: flagBl,
  BM: flagBm,
  BN: flagBn,
  BO: flagBo,
  BQ: flagBq,
  BR: flagBr,
  BS: flagBs,
  BT: flagBt,
  BV: flagBv,
  BW: flagBw,
  BY: flagBy,
  BZ: flagBz,
  CA: flagCa,
  CC: flagCc,
  CD: flagCd,
  CF: flagCf,
  CG: flagCg,
  CH: flagCh,
  CI: flagCi,
  CK: flagCk,
  CL: flagCl,
  CM: flagCm,
  CN: flagCn,
  CO: flagCo,
  CP: flagCp,
  CR: flagCr,
  CU: flagCu,
  CV: flagCv,
  CW: flagCw,
  CX: flagCx,
  CY: flagCy,
  CZ: flagCz,
  DE: flagDe,
  DG: flagDg,
  DJ: flagDj,
  DK: flagDk,
  DM: flagDm,
  DO: flagDo,
  DZ: flagDz,
  EA: flagEa,
  EC: flagEc,
  EE: flagEe,
  EG: flagEg,
  EH: flagEh,
  ER: flagEr,
  ES: flagEs,
  ET: flagEt,
  EU: flagEu,
  FI: flagFi,
  FJ: flagFj,
  FK: flagFk,
  FM: flagFm,
  FO: flagFo,
  FR: flagFr,
  GA: flagGa,
  GB: flagGb,
  GD: flagGd,
  GE: flagGe,
  GF: flagGf,
  GG: flagGg,
  GH: flagGh,
  GI: flagGi,
  GL: flagGl,
  GM: flagGm,
  GN: flagGn,
  GP: flagGp,
  GQ: flagGq,
  GR: flagGr,
  GS: flagGs,
  GT: flagGt,
  GU: flagGu,
  GW: flagGw,
  GY: flagGy,
  HK: flagHk,
  HM: flagHm,
  HN: flagHn,
  HR: flagHr,
  HT: flagHt,
  HU: flagHu,
  IC: flagIc,
  ID: flagId,
  IE: flagIe,
  IL: flagIl,
  IM: flagIm,
  IN: flagIn,
  IO: flagIo,
  IQ: flagIq,
  IR: flagIr,
  IS: flagIs,
  IT: flagIt,
  JE: flagJe,
  JM: flagJm,
  JO: flagJo,
  JP: flagJp,
  KE: flagKe,
  KG: flagKg,
  KH: flagKh,
  KI: flagKi,
  KM: flagKm,
  KN: flagKn,
  KP: flagKp,
  KR: flagKr,
  KW: flagKw,
  KY: flagKy,
  KZ: flagKz,
  LA: flagLa,
  LB: flagLb,
  LC: flagLc,
  LI: flagLi,
  LK: flagLk,
  LR: flagLr,
  LS: flagLs,
  LT: flagLt,
  LU: flagLu,
  LV: flagLv,
  LY: flagLy,
  MA: flagMa,
  MC: flagMc,
  MD: flagMd,
  ME: flagMe,
  MF: flagMf,
  MG: flagMg,
  MH: flagMh,
  MK: flagMk,
  ML: flagMl,
  MM: flagMm,
  MN: flagMn,
  MO: flagMo,
  MP: flagMp,
  MQ: flagMq,
  MR: flagMr,
  MS: flagMs,
  MT: flagMt,
  MU: flagMu,
  MV: flagMv,
  MW: flagMw,
  MX: flagMx,
  MY: flagMy,
  MZ: flagMz,
  NA: flagNa,
  NC: flagNc,
  NE: flagNe,
  NF: flagNf,
  NG: flagNg,
  NI: flagNi,
  NL: flagNl,
  NO: flagNo,
  NP: flagNp,
  NR: flagNr,
  NU: flagNu,
  NZ: flagNz,
  OM: flagOm,
  PA: flagPa,
  PE: flagPe,
  PF: flagPf,
  PG: flagPg,
  PH: flagPh,
  PK: flagPk,
  PL: flagPl,
  PM: flagPm,
  PN: flagPn,
  PR: flagPr,
  PS: flagPs,
  PT: flagPt,
  PW: flagPw,
  PY: flagPy,
  QA: flagQa,
  RE: flagRe,
  RO: flagRo,
  RS: flagRs,
  RU: flagRu,
  RW: flagRw,
  SA: flagSa,
  SB: flagSb,
  SC: flagSc,
  SD: flagSd,
  SE: flagSe,
  SG: flagSg,
  SH: flagSh,
  SI: flagSi,
  SJ: flagSj,
  SK: flagSk,
  SL: flagSl,
  SM: flagSm,
  SN: flagSn,
  SO: flagSo,
  SR: flagSr,
  SS: flagSs,
  ST: flagSt,
  SV: flagSv,
  SX: flagSx,
  SY: flagSy,
  SZ: flagSz,
  TC: flagTc,
  TD: flagTd,
  TF: flagTf,
  TG: flagTg,
  TH: flagTh,
  TJ: flagTj,
  TK: flagTk,
  TL: flagTl,
  TM: flagTm,
  TN: flagTn,
  TO: flagTo,
  TR: flagTr,
  TT: flagTt,
  TV: flagTv,
  TW: flagTw,
  TZ: flagTz,
  UA: flagUa,
  UG: flagUg,
  UK: flagUk,
  UM: flagUm,
  US: flagUs,
  UY: flagUy,
  UZ: flagUz,
  VA: flagVa,
  VC: flagVc,
  VE: flagVe,
  VG: flagVg,
  VI: flagVi,
  VN: flagVn,
  VU: flagVu,
  WF: flagWf,
  WS: flagWs,
  XX: flagXx,
  YE: flagYe,
  YT: flagYt,
  ZA: flagZa,
  ZM: flagZm,
  ZW: flagZw,
};
