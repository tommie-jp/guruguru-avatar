// 中継サーバ(server/relay.mjs)につなぐ最小 WebSocket クライアント。
//
// docs-camera/11 のメッセージ規約:
//   - 状態フレーム: JSON 配列 [...]（state-codec の encode/decode 済み）
//   - それ以外: JSON オブジェクト { type, ... }
//       config        : { type:'config', tweaks }     producer→consumer（設定配布）
//       cue           : { type:'cue', id, stamp?, color?, size?, shadow?, offset?, hold?, anim?, weight?, stroke?,
//                         rotation?, place?, halo?, glow?, glowColor?, gain? }
//                       producer→consumer（演出トリガ＋スタンプ見た目の全カスタム。効果音差し替えは非対象）
//       cursor        : { type:'cursor', data:{ x, y, w, h, show } }  producer→consumer
//                       （操作側のマウスカーソル位置。w,h は送信元キャンバスサイズ。show:false で消す。
//                        ephemeral なので後着 OBS への再送はしない＝次の移動で出る）
//       draw-scene    : { type:'draw-scene', data:{ scene, w, h } }  producer→consumer
//                       （お絵かきオーバーレイの fabric シーン全体。w,h は送信元キャンバスの
//                        論理サイズで、rx 側が viewportTransform で自分のサイズへ拡縮する）
//       draw-live     : { type:'draw-live', data:{ phase, id, pts?, color?, width?, w?, h? } }  producer→consumer
//                       （描画途中のペンストロークをリアルタイムに流す。phase='start'|'move'|'end'。
//                        start=初点+color/width/w/h、move=増分ポイントのみ、end=id だけ。cursor と同じく
//                        ephemeral＝後着 OBS への再送はしない。確定は draw-scene が担い rx が到着で置換）
//       ticker        : { type:'ticker', data:{ text, bgColor, textColor, speed, visible, posY, opacity } }  producer→consumer
//                       （CNN 風の下部テロップ設定。累積状態＝変更時のみ送るので後着 OBS へは
//                        need-config で再送する（draw-scene と同様）。クロールのアニメは rx が
//                        設定からローカル駆動するので、毎フレームは流れない）
//       need-config   : { type:'need-config' }         server→producer（CEF 接続時の要求）
//       peer          : { type:'peer', ... }           server→producer（CEF 接続/切断の通知）
//
// 切断時は指数バックオフで自動再接続する。送信は readyState を見て握りつぶす
// （未接続時の例外を出さない＝呼び出し側は気にしなくてよい）。

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;

/**
 * @param {Object} o
 * @param {string} o.url      ws(s):// の中継 URL
 * @param {'tx'|'rx'} o.role  役割（サーバが producer/consumer を振り分ける）
 * @param {(frame:Array<number>)=>void} [o.onState]    状態フレーム受信（rx 用）
 * @param {(tweaks:object)=>void} [o.onConfig]         config 受信（rx 用）
 * @param {(id:string, over:{stamp?:string,color?:string,size?:number,shadow?:string,offset?:{x:number,y:number}})=>void} [o.onCue]  cue 受信（rx 用・演出トリガ＋カスタム文字/色/倍率/影色/位置）
 * @param {(data:{scene:object,w:number,h:number})=>void} [o.onDrawScene]  draw-scene 受信（rx 用・お絵かきシーン）
 * @param {(data:{phase:string,id:number,pts?:Array,color?:string,width?:number,w?:number,h?:number})=>void} [o.onDrawLive]  draw-live 受信（rx 用・描画途中のライブストローク）
 * @param {(data:{x:number,y:number,w:number,h:number,show:boolean})=>void} [o.onCursor]  cursor 受信（rx 用・マウスカーソル）
 * @param {(data:{text:string,bgColor:string,textColor:string,speed:number,visible:boolean,posY:number,opacity:number})=>void} [o.onTicker]  ticker 受信（rx 用・テロップ設定）
 * @param {()=>void} [o.onNeedConfig]                  config 要求受信（tx 用）
 * @param {(msg:object)=>void} [o.onPeer]              接続通知受信（tx 用）
 * @param {(s:{connected:boolean})=>void} [o.onStatus] 自身の接続状態変化
 * @param {(url:string)=>WebSocket} [o.makeSocket]     テスト用の差し替え口
 * @returns {{ sendState:Function, sendConfig:Function, sendCue:(id:string, over?:{stamp?:string,color?:string})=>void, sendDrawScene:(data:object)=>void, sendDrawLive:(data:object)=>void, sendCursor:(data:object)=>void, sendTicker:(data:object)=>void, close:()=>void }}
 */
export function createRelayClient(o) {
  const {
    url, role, onState, onConfig, onCue, onDrawScene, onDrawLive, onCursor, onTicker, onNeedConfig, onPeer, onStatus,
    makeSocket = (u) => new WebSocket(u),
  } = o;

  const fullUrl = `${url}${url.includes('?') ? '&' : '?'}role=${encodeURIComponent(role)}`;
  let ws = null;
  let backoff = INITIAL_BACKOFF_MS;
  let reconnectTimer = 0;
  let closed = false; // 明示 close() 後は再接続しない

  function connect() {
    ws = makeSocket(fullUrl);

    ws.onopen = () => {
      backoff = INITIAL_BACKOFF_MS;
      onStatus?.({ connected: true });
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return; // 壊れたメッセージは無視
      }
      if (Array.isArray(msg)) {
        onState?.(msg);
        return;
      }
      switch (msg && msg.type) {
        case 'config': onConfig?.(msg.tweaks); break;
        case 'cue': onCue?.(msg.id, {
          stamp: msg.stamp, color: msg.color, size: msg.size, shadow: msg.shadow, offset: msg.offset,
          hold: msg.hold, anim: msg.anim, weight: msg.weight, stroke: msg.stroke,
          rotation: msg.rotation, place: msg.place, halo: msg.halo, glow: msg.glow, glowColor: msg.glowColor, gain: msg.gain,
        }); break;
        case 'draw-scene': onDrawScene?.(msg.data); break;
        case 'draw-live': onDrawLive?.(msg.data); break;
        case 'cursor': onCursor?.(msg.data); break;
        case 'ticker': onTicker?.(msg.data); break;
        case 'need-config': onNeedConfig?.(); break;
        case 'peer': onPeer?.(msg); break;
        default: break;
      }
    };

    ws.onerror = () => {
      // onclose に任せる（onerror 後はほぼ必ず close する）。
      try { ws.close(); } catch { /* noop */ }
    };

    ws.onclose = () => {
      onStatus?.({ connected: false });
      if (closed) return;
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    };
  }

  connect();

  function rawSend(payload) {
    if (ws && ws.readyState === 1) {
      try { ws.send(payload); } catch { /* 送信失敗は次フレームで回復 */ }
    }
  }

  return {
    sendState(frame) { rawSend(JSON.stringify(frame)); },
    sendConfig(tweaks) { rawSend(JSON.stringify({ type: 'config', tweaks })); },
    sendCue(id, over) {
      const m = { type: 'cue', id };
      if (over && over.stamp) m.stamp = over.stamp;
      if (over && over.color) m.color = over.color;
      if (over && over.size != null) m.size = over.size;
      if (over && over.shadow) m.shadow = over.shadow;
      if (over && over.offset) m.offset = over.offset;
      if (over && over.hold != null) m.hold = over.hold;
      if (over && over.anim) m.anim = over.anim;
      if (over && over.weight != null) m.weight = over.weight;
      if (over && over.stroke != null) m.stroke = over.stroke;
      if (over && over.rotation != null) m.rotation = over.rotation;
      if (over && over.place) m.place = over.place;
      if (over && over.halo != null) m.halo = over.halo;
      if (over && over.glow != null) m.glow = over.glow;
      if (over && over.glowColor) m.glowColor = over.glowColor;
      if (over && over.gain != null) m.gain = over.gain;
      rawSend(JSON.stringify(m));
    },
    sendDrawScene(data) { rawSend(JSON.stringify({ type: 'draw-scene', data })); },
    sendDrawLive(data) { rawSend(JSON.stringify({ type: 'draw-live', data })); },
    sendCursor(data) { rawSend(JSON.stringify({ type: 'cursor', data })); },
    sendTicker(data) { rawSend(JSON.stringify({ type: 'ticker', data })); },
    close() {
      closed = true;
      clearTimeout(reconnectTimer);
      try { ws?.close(); } catch { /* noop */ }
    },
  };
}
