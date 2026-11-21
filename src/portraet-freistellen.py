"""Local studio-portrait cutout. Foreground pixels remain unchanged; only alpha is added."""
import sys
import cv2
import numpy as np

source, target = sys.argv[1:3]
image = cv2.imread(source, cv2.IMREAD_UNCHANGED)
if image is None:
    raise ValueError("Porträt konnte nicht gelesen werden")
if image.ndim == 3 and image.shape[2] == 4 and image[:, :, 3].min() < 250:
    cv2.imwrite(target, image)
    sys.exit(0)
image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR) if image.ndim == 2 else image[:, :, :3]
h, w = image.shape[:2]
scale = min(1, 900 / max(h, w))
small = cv2.resize(image, (round(w * scale), round(h * scale)))
sh, sw = small.shape[:2]
# Neutral, light studio backdrop; fail rather than silently damaging an arbitrary photo.
edges = np.concatenate([small[:4].reshape(-1, 3), small[:, :4].reshape(-1, 3), small[:, -4:].reshape(-1, 3)])
background = np.median(edges, axis=0)
if background.min() < 125 or background.max() - background.min() > 55:
    raise ValueError("Bitte ein Porträt vor hellem, ruhigem Hintergrund oder ein freigestelltes PNG verwenden")
distance = np.linalg.norm(small.astype(float) - background, axis=2)
mask = np.where(distance < 35, cv2.GC_PR_BGD, cv2.GC_PR_FGD).astype('uint8')
# A bright neutral backdrop must not survive as a large grey foreground island.
colored = ((small.max(axis=2).astype(int)-small.min(axis=2).astype(int)>38) | (small.max(axis=2)<130)).astype('uint8')*255
contours, _ = cv2.findContours(colored, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
points = [c for c in contours if cv2.contourArea(c)>sh*sw*.001]
if points:
    hull = cv2.convexHull(np.concatenate(points))
    possible = np.zeros((sh, sw), 'uint8')
    cv2.fillConvexPoly(possible, hull, 255)
    possible = cv2.dilate(possible, np.ones((5,5),'uint8'))
    mask[possible==0]=cv2.GC_BGD
mask[:2] = mask[:, :2] = mask[:, -2:] = cv2.GC_BGD
# The shirt belongs to the subject, even when as bright as the backdrop.
cv2.rectangle(mask, (round(sw * .48), round(sh * .50)), (round(sw * .60), sh - 1), cv2.GC_FGD, -1)
cv2.grabCut(small, mask, None, np.zeros((1, 65)), np.zeros((1, 65)), 5, cv2.GC_INIT_WITH_MASK)
alpha = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype('uint8')
count, labels, stats, _ = cv2.connectedComponentsWithStats(alpha)
if count < 2:
    raise ValueError("Keine Person freigestellt; bitte ein transparentes PNG verwenden")
largest = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
alpha = np.where(labels == largest, 255, 0).astype('uint8')
if not .1 < (alpha > 0).mean() < .92:
    raise ValueError("Freistellung unklar; bitte ein transparentes PNG verwenden")
alpha = cv2.erode(alpha, np.ones((2,2), np.uint8))
alpha = cv2.resize(alpha, (w, h), interpolation=cv2.INTER_LINEAR)
result = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
result[:, :, 3] = alpha
ys, xs = np.where(alpha > 8)
result = result[max(0, ys.min()-4):min(h, ys.max()+5), max(0, xs.min()-4):min(w, xs.max()+5)]
if not cv2.imwrite(target, result):
    raise ValueError("Freistellung konnte nicht gespeichert werden")
