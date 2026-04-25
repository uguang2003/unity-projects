/**
 * @description: Unity WebGL 分片资源运行时加载器
 *   接管 createUnityInstance 配置中所有 .gz 资源（dataUrl/frameworkUrl/codeUrl）：
 *   - 若同目录存在 .manifest.json，则按 manifest 下载全部分片并合并；
 *   - 否则直接 fetch 整个 .gz 文件；
 *   随后用浏览器原生 DecompressionStream 解压为明文，再以 Blob URL 形式重写
 *   回 config，避开 web server 必须配置 Content-Encoding: gzip 的限制（Python
 *   http.server / EdgeOne 默认都不会给 .gz 文件加该响应头，否则 Unity loader.js
 *   会报 "Unable to parse Build/xxx.gz!"）。
 *   暴露 window.UnitySplitLoader.preloadSplitFiles(config, onProgress) -> Promise。
 * @author: UG - 一个斗码大陆苦逼的三段码之气的少年，并没有神秘戒指中码老的帮助，但总有一天，我会成为斗码大陆中码帝一样的存在。三十年河东，三十年河西，莫欺少年穷。
 * @date: 2026-04-25
 */
(function () {
  const TARGET_FIELDS = ['dataUrl', 'frameworkUrl', 'codeUrl'];
  // Unity 解析时会校验 Content-Type；codeUrl 必须是 application/wasm
  // 才能走 WebAssembly.instantiateStreaming 流式编译，否则会有性能告警
  const FIELD_MIME = {
    dataUrl: 'application/octet-stream',
    frameworkUrl: 'application/javascript',
    codeUrl: 'application/wasm',
  };

  async function tryFetchManifest(url) {
    try {
      const resp = await fetch(`${url}.manifest.json`, { cache: 'force-cache' });
      if (!resp.ok) return null;
      const manifest = await resp.json();
      if (!manifest || !manifest.parts || manifest.parts < 2) return null;
      return manifest;
    } catch (e) {
      return null;
    }
  }

  async function fetchAsBuffer(url) {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`资源下载失败 ${url}: HTTP ${resp.status}`);
    }
    return resp.arrayBuffer();
  }

  async function getRemoteSize(url) {
    try {
      const resp = await fetch(url, { method: 'HEAD' });
      const len = resp.headers.get('Content-Length');
      return len ? parseInt(len, 10) : 0;
    } catch (e) {
      return 0;
    }
  }

  async function decompressGzipBuffers(buffers) {
    const blob = new Blob(buffers);
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }

  async function preloadSplitFiles(config, onProgress) {
    if (typeof DecompressionStream === 'undefined') {
      console.warn('[UnitySplitLoader] 当前浏览器不支持 DecompressionStream，跳过预解压；服务器需要为 .gz 文件配置 Content-Encoding: gzip');
      if (onProgress) onProgress(1);
      return { processed: false };
    }

    const targets = [];
    for (const field of TARGET_FIELDS) {
      const url = config[field];
      if (!url || !url.endsWith('.gz')) continue;
      const manifest = await tryFetchManifest(url);
      const totalSize = manifest ? manifest.totalSize : await getRemoteSize(url);
      targets.push({ field, baseUrl: url, manifest, totalSize });
    }

    if (targets.length === 0) {
      if (onProgress) onProgress(1);
      return { processed: false };
    }

    const totalBytes = targets.reduce((sum, t) => sum + (t.totalSize || 0), 0) || 1;
    let loadedBytes = 0;
    const reportProgress = () => {
      if (onProgress) onProgress(Math.min(loadedBytes / totalBytes, 1));
    };

    for (const t of targets) {
      let buffers;
      if (t.manifest) {
        buffers = new Array(t.manifest.parts);
        for (let i = 0; i < t.manifest.parts; i++) {
          const partUrl = `${t.baseUrl}.part${String(i).padStart(2, '0')}`;
          const buf = await fetchAsBuffer(partUrl);
          buffers[i] = buf;
          loadedBytes += buf.byteLength;
          reportProgress();
        }
      } else {
        const buf = await fetchAsBuffer(t.baseUrl);
        buffers = [buf];
        loadedBytes += buf.byteLength;
        reportProgress();
      }

      const decompressed = await decompressGzipBuffers(buffers);
      const mime = FIELD_MIME[t.field] || 'application/octet-stream';
      const blob = new Blob([decompressed], { type: mime });
      config[t.field] = URL.createObjectURL(blob);
    }

    return { processed: true };
  }

  window.UnitySplitLoader = { preloadSplitFiles };
})();
