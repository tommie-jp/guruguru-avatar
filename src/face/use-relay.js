// createRelayClient を React のライフサイクルに載せるフック。
//
// tx: producer として接続。need-config 要求が来たら現在の設定で応答し、peer 通知で
//     CEF の接続台数を state に反映（iPhone 画面の「CEF 接続中」表示用）。
// rx: consumer として接続。状態フレーム/コンフィグの受信は onState/onConfig に流す。
// local: 何もしない（送受信なし）。
//
// コールバックや getConfig は毎レンダーで変わる closure なので ref 経由で参照し、
// mode / relayUrl が変わったときだけ再接続する（フレーム毎の再購読を避ける）。
import React from 'react';
import { createRelayClient } from './relay-client';

const { useRef, useState, useEffect } = React;

/**
 * @param {'local'|'tx'|'rx'} mode
 * @param {Object} o
 * @param {string} o.relayUrl
 * @param {()=>object} [o.getConfig]          tx: need-config への応答に使う現在の tweaks
 * @param {()=>(object|null)} [o.getDrawScene] tx: need-config 時に後着 OBS へ再送するお絵かきシーン（無ければ null）
 * @param {()=>(object|null)} [o.getTicker]    tx: need-config 時に後着 OBS へ再送するテロップ設定（無ければ null）
 * @param {(frame:Array<number>)=>void} [o.onState]  rx: 状態フレーム受信
 * @param {(tweaks:object)=>void} [o.onConfig]       rx: config 受信
 * @param {(id:string, over:{stamp?:string,color?:string})=>void} [o.onCue]  rx: 演出キュー受信（tx の発火＋カスタム文字/色を再生）
 * @param {(data:{scene:object,w:number,h:number})=>void} [o.onDrawScene]  rx: お絵かきシーン受信
 * @param {(data:{phase:string,id:number,pts?:Array,color?:string,width?:number,w?:number,h?:number})=>void} [o.onDrawLive]  rx: 描画途中のライブストローク受信
 * @param {(data:{x:number,y:number,w:number,h:number,show:boolean})=>void} [o.onCursor]  rx: マウスカーソル受信
 * @param {(data:{text:string,bgColor:string,textColor:string,speed:number,visible:boolean})=>void} [o.onTicker]  rx: テロップ設定受信
 * @returns {{ sendState:Function, sendConfig:Function, sendCue:(id:string, over?:{stamp?:string,color?:string})=>void,
 *            sendDrawScene:(data:object)=>void, sendDrawLive:(data:object)=>void, sendCursor:(data:object)=>void, sendTicker:(data:object)=>void, peer:{connected:boolean,count:number}, linkUp:boolean }}
 */
export function useRelay(mode, { relayUrl, getConfig, getDrawScene, getTicker, onState, onConfig, onCue, onDrawScene, onDrawLive, onCursor, onTicker } = {}) {
  const clientRef = useRef(null);
  // CEF（consumer）の接続状態。tx の画面表示用。
  const [peer, setPeer] = useState({ connected: false, count: 0 });
  // 自分自身の WS 接続状態。
  const [linkUp, setLinkUp] = useState(false);

  // 最新の closure を ref に保持（再接続を起こさずに中身だけ差し替える）。
  const cbRef = useRef({});
  cbRef.current = { getConfig, getDrawScene, getTicker, onState, onConfig, onCue, onDrawScene, onDrawLive, onCursor, onTicker };

  useEffect(() => {
    if (mode === 'local') {
      setLinkUp(false);
      setPeer({ connected: false, count: 0 });
      return undefined;
    }
    const client = createRelayClient({
      url: relayUrl,
      role: mode,
      onState: mode === 'rx' ? (f) => cbRef.current.onState?.(f) : undefined,
      onConfig: mode === 'rx' ? (t) => cbRef.current.onConfig?.(t) : undefined,
      onCue: mode === 'rx' ? (id, over) => cbRef.current.onCue?.(id, over) : undefined,
      onDrawScene: mode === 'rx' ? (data) => cbRef.current.onDrawScene?.(data) : undefined,
      onDrawLive: mode === 'rx' ? (data) => cbRef.current.onDrawLive?.(data) : undefined,
      onCursor: mode === 'rx' ? (data) => cbRef.current.onCursor?.(data) : undefined,
      onTicker: mode === 'rx' ? (data) => cbRef.current.onTicker?.(data) : undefined,
      // CEF(OBS) が後から繋がったら、config に加えてお絵かきシーン・テロップ設定も再送する（取りこぼし防止）。
      // 累積状態なので pose のように毎フレーム送らない → 接続時の再送が必須。
      onNeedConfig: mode === 'tx'
        ? () => {
            const cfg = cbRef.current.getConfig?.();
            if (cfg) client.sendConfig(cfg);
            const scene = cbRef.current.getDrawScene?.();
            if (scene) client.sendDrawScene(scene);
            const ticker = cbRef.current.getTicker?.();
            if (ticker) client.sendTicker(ticker);
          }
        : undefined,
      onPeer: mode === 'tx'
        ? (m) => setPeer({ connected: (m.count || 0) > 0, count: m.count || 0 })
        : undefined,
      onStatus: (s) => setLinkUp(s.connected),
    });
    clientRef.current = client;
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [mode, relayUrl]);

  return {
    sendState(frame) { clientRef.current?.sendState(frame); },
    sendConfig(tweaks) { clientRef.current?.sendConfig(tweaks); },
    sendCue(id, over) { clientRef.current?.sendCue(id, over); },
    sendDrawScene(data) { clientRef.current?.sendDrawScene(data); },
    sendDrawLive(data) { clientRef.current?.sendDrawLive(data); },
    sendCursor(data) { clientRef.current?.sendCursor(data); },
    sendTicker(data) { clientRef.current?.sendTicker(data); },
    peer,
    linkUp,
  };
}
