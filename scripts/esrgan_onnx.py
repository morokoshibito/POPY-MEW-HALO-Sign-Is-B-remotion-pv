"""Convert Real-ESRGAN realesr-animevideov3.pth (SRVGGNetCompact, x4) to ONNX without PyTorch,
and upscale images with onnxruntime.

Usage:
  python esrgan_onnx.py convert realesr-animevideov3.pth model.onnx
  python esrgan_onnx.py run model.onnx in.png out.png [final_scale=2]
"""
import pickle
import sys
import zipfile

import numpy as np


# ---------------------------------------------------------------- .pth reader (no torch)

class _Storage:
    def __init__(self, key, dtype):
        self.key, self.dtype = key, dtype


def read_pth(path):
    z = zipfile.ZipFile(path)
    root = z.namelist()[0].split("/")[0]
    dtypes = {"FloatStorage": np.float32, "HalfStorage": np.float16, "LongStorage": np.int64}

    def rebuild(storage, offset, size, stride, *args):
        raw = np.frombuffer(z.read(f"{root}/data/{storage.key}"), dtype=storage.dtype)
        if not size:
            return raw[offset:offset + 1].reshape(())
        arr = np.lib.stride_tricks.as_strided(raw[offset:], shape=size, strides=[s * raw.itemsize for s in stride])
        return np.array(arr)

    class U(pickle.Unpickler):
        def find_class(self, mod, name):
            if name == "_rebuild_tensor_v2":
                return rebuild
            if name in dtypes:
                return name
            if name == "OrderedDict":
                import collections
                return collections.OrderedDict
            return super().find_class(mod, name)

        def persistent_load(self, pid):
            _, typ, key, _, _ = pid
            return _Storage(key, dtypes[typ])

    return U(z.open(f"{root}/data.pkl")).load()


def convert(pth, out):
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    sd = read_pth(pth)
    sd = sd.get("params", sd)
    # body.{0,2,4,...} conv, body.{1,3,...} prelu, last conv = upsample conv
    idx = sorted({int(k.split(".")[1]) for k in sd if k.startswith("body.")})
    nodes, inits = [], []
    cur = "x"
    for i in idx:
        w = sd.get(f"body.{i}.weight")
        b = sd.get(f"body.{i}.bias")
        if w is None:
            continue
        if w.ndim == 4:  # conv
            inits += [numpy_helper.from_array(w.astype(np.float32), f"w{i}"), numpy_helper.from_array(b.astype(np.float32), f"b{i}")]
            nodes.append(helper.make_node("Conv", [cur, f"w{i}", f"b{i}"], [f"c{i}"], pads=[1, 1, 1, 1]))
            cur = f"c{i}"
        else:  # prelu
            inits.append(numpy_helper.from_array(w.reshape(-1, 1, 1).astype(np.float32), f"p{i}"))
            nodes.append(helper.make_node("PRelu", [cur, f"p{i}"], [f"r{i}"]))
            cur = f"r{i}"
    scale = 4
    nodes.append(helper.make_node("DepthToSpace", [cur], ["ps"], blocksize=scale, mode="CRD"))
    nodes.append(helper.make_node("Resize", ["x", "", "sc"], ["up"], mode="nearest"))
    inits.append(numpy_helper.from_array(np.array([1, 1, scale, scale], np.float32), "sc"))
    nodes.append(helper.make_node("Add", ["ps", "up"], ["y"]))
    g = helper.make_graph(nodes, "srvgg", [helper.make_tensor_value_info("x", TensorProto.FLOAT, [1, 3, None, None])],
                          [helper.make_tensor_value_info("y", TensorProto.FLOAT, [1, 3, None, None])], inits)
    m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 13)])
    m.ir_version = 8
    onnx.checker.check_model(m)
    onnx.save(m, out)
    print(f"[esrgan] {len([k for k in sd if k.endswith('weight')])} weight tensors -> {out}")


def run(model, src, dst, final_scale=2.0, tile=256, pad=12):
    import onnxruntime as ort
    from PIL import Image

    sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    im = Image.open(src).convert("RGB")
    a = np.asarray(im).astype(np.float32) / 255.0
    h, w, _ = a.shape
    out = np.zeros((h * 4, w * 4, 3), np.float32)
    for y in range(0, h, tile):
        for x in range(0, w, tile):
            y0, x0 = max(0, y - pad), max(0, x - pad)
            y1, x1 = min(h, y + tile + pad), min(w, x + tile + pad)
            t = a[y0:y1, x0:x1].transpose(2, 0, 1)[None]
            r = sess.run(None, {"x": t})[0][0].transpose(1, 2, 0)
            oy, ox = (y - y0) * 4, (x - x0) * 4
            th, tw = min(tile, h - y) * 4, min(tile, w - x) * 4
            out[y * 4:y * 4 + th, x * 4:x * 4 + tw] = r[oy:oy + th, ox:ox + tw]
    big = Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))
    if final_scale != 4:
        big = big.resize((round(w * final_scale), round(h * final_scale)), Image.LANCZOS)
    big.save(dst)
    print(f"[esrgan] {src} {w}x{h} -> {dst} {big.size[0]}x{big.size[1]}")


if __name__ == "__main__":
    if sys.argv[1] == "convert":
        convert(sys.argv[2], sys.argv[3])
    else:
        run(sys.argv[2], sys.argv[3], sys.argv[4], float(sys.argv[5]) if len(sys.argv) > 5 else 2.0)
