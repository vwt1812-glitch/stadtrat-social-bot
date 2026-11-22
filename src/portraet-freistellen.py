"""Local segmentation followed by colour-aware soft alpha matting.

Original pixels are retained inside the subject. PyMatting estimates foreground
colours at translucent edges so the studio background does not form a pale rim.
"""
import sys, pathlib, hashlib
import cv2
import numpy as np


def soft_cutout(image, prediction):
    from scipy.ndimage import binary_erosion
    from pymatting import estimate_alpha_cf, estimate_foreground_ml
    h, w = image.shape[:2]
    scale = min(1, 2000 / max(h, w))
    size = (round(w * scale), round(h * scale))
    small = cv2.resize(image, size, interpolation=cv2.INTER_AREA)
    mask = cv2.resize(prediction, size, interpolation=cv2.INTER_CUBIC).clip(0, 1)
    fg = binary_erosion(mask > 240/255, iterations=5)
    bg = binary_erosion(mask < 10/255, iterations=5, border_value=1)
    if not fg.any() or not bg.any():
        raise ValueError('Keine eindeutige Person mit Hintergrund erkannt')
    trimap = np.full(mask.shape, .5)
    trimap[fg] = 1
    trimap[bg] = 0
    rgb = small.astype(np.float64) / 255
    alpha = estimate_alpha_cf(rgb, trimap).clip(0, 1)
    foreground = estimate_foreground_ml(rgb, alpha).clip(0, 1)
    alpha = cv2.resize(alpha, (w, h), interpolation=cv2.INTER_CUBIC).clip(0, 1)
    foreground = cv2.resize(foreground, (w, h), interpolation=cv2.INTER_CUBIC).clip(0, 1)
    # Keep the original photograph, including face, skin and suit texture.
    foreground[alpha >= .999] = image[alpha >= .999] / 255
    if not .08 < float((alpha > .5).mean()) < .95:
        raise ValueError('Freistellung unklar')
    result = np.dstack([np.round(foreground*255).astype(np.uint8), np.round(alpha*255).astype(np.uint8)])
    ys, xs = np.where(alpha > .02)
    return result[max(0,ys.min()-4):min(h,ys.max()+5), max(0,xs.min()-4):min(w,xs.max()+5)]


def main():
    source, target = sys.argv[1:3]
    image = cv2.imread(source, cv2.IMREAD_UNCHANGED)
    if image is None:
        raise ValueError('Porträt konnte nicht gelesen werden')
    if image.ndim == 3 and image.shape[2] == 4 and image[:,:,3].min() < 250:
        if not cv2.imwrite(target, image):
            raise ValueError('Freistellung nicht gespeichert')
        return
    image = cv2.imread(source, cv2.IMREAD_COLOR)  # respects EXIF orientation
    root = pathlib.Path(__file__).resolve().parents[1]
    precise = root / 'daten/modelle/isnet-general-use.onnx'
    model = pathlib.Path(sys.argv[3]) if len(sys.argv)>3 else (precise if precise.exists() else root/'assets/models/u2netp.onnx')
    isnet = model.name == 'isnet-general-use.onnx'
    expected = 'fc16ebd8b0c10d971d3513d564d01e29' if isnet else '8e83ca70e441ab06c318d82300c84806'
    if hashlib.md5(model.read_bytes()).hexdigest() != expected:
        raise ValueError('Freistellungsmodell beschädigt')
    side = 1024 if isnet else 320
    rgb = cv2.cvtColor(cv2.resize(image,(side,side)),cv2.COLOR_BGR2RGB).astype(np.float32)
    rgb /= max(1,float(rgb.max()))
    rgb = rgb-.5 if isnet else (rgb-np.array([.485,.456,.406],np.float32))/np.array([.229,.224,.225],np.float32)
    net=cv2.dnn.readNetFromONNX(str(model))
    net.setInput(rgb.transpose(2,0,1)[None])
    pred=net.forward(net.getUnconnectedOutLayersNames())[0].squeeze()
    if float(pred.max()-pred.min())<1e-6:
        raise ValueError('Keine Person erkannt')
    pred=(pred-pred.min())/(pred.max()-pred.min())
    del net  # release inference memory before the sparse matting calculation
    result = soft_cutout(image, pred)
    if not cv2.imwrite(target,result):
        raise ValueError('Freistellung nicht gespeichert')


if __name__ == '__main__':
    main()
