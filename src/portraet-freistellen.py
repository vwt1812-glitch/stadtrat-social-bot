"""U2Netp foreground mask with guided edges; original subject colours are retained."""
import sys, pathlib, hashlib
import cv2
import numpy as np
source, target = sys.argv[1:3]
image = cv2.imread(source, cv2.IMREAD_UNCHANGED)
if image is None: raise ValueError("Porträt konnte nicht gelesen werden")
if image.ndim==3 and image.shape[2]==4 and image[:,:,3].min()<250:
    cv2.imwrite(target,image);sys.exit(0)
image=cv2.cvtColor(image,cv2.COLOR_GRAY2BGR) if image.ndim==2 else image[:,:,:3]
model=pathlib.Path(sys.argv[3]) if len(sys.argv)>3 else pathlib.Path(__file__).resolve().parents[1]/'assets/models/u2netp.onnx'
if hashlib.md5(model.read_bytes()).hexdigest()!='8e83ca70e441ab06c318d82300c84806':raise ValueError('Freistellungsmodell beschädigt')
rgb=cv2.cvtColor(cv2.resize(image,(320,320)),cv2.COLOR_BGR2RGB).astype(np.float32)
rgb/=max(1,float(rgb.max()))
rgb=(rgb-np.array([.485,.456,.406],np.float32))/np.array([.229,.224,.225],np.float32)
net=cv2.dnn.readNetFromONNX(str(model));net.setInput(rgb.transpose(2,0,1)[None])
pred=net.forward(net.getUnconnectedOutLayersNames())[0].squeeze()
if float(pred.max()-pred.min())<1e-6:raise ValueError('Keine Person erkannt')
pred=(pred-pred.min())/(pred.max()-pred.min())
h,w=image.shape[:2]
scale=min(1,900/max(h,w));sw,sh=round(w*scale),round(h*scale)
small=cv2.resize(image,(sw,sh));m=(cv2.resize(pred,(sw,sh))>.5).astype(np.uint8)
# Model-guided trimap: the local colour model refines only a narrow uncertain edge band.
mask=np.where(m,cv2.GC_PR_FGD,cv2.GC_PR_BGD).astype(np.uint8)
mask[cv2.erode(m,np.ones((9,9),np.uint8))>0]=cv2.GC_FGD
mask[cv2.dilate(m,np.ones((9,9),np.uint8))==0]=cv2.GC_BGD
cv2.grabCut(small,mask,None,np.zeros((1,65)),np.zeros((1,65)),5,cv2.GC_INIT_WITH_MASK)
alpha=((mask==cv2.GC_FGD)|(mask==cv2.GC_PR_FGD)).astype(np.uint8)
alpha=cv2.erode(alpha,np.ones((2,2),np.uint8))
q=cv2.resize(alpha.astype(np.float32),(w,h),interpolation=cv2.INTER_LINEAR)
q=cv2.GaussianBlur(q,(0,0),.55).clip(0,1)
if not .08<float((q>.5).mean())<.95:raise ValueError('Freistellung unklar')
# Remove the light studio matte only from semitransparent boundary pixels.
edges=np.concatenate([image[:3].reshape(-1,3),image[:,:3].reshape(-1,3),image[:,-3:].reshape(-1,3)])
bg=np.median(edges,axis=0).astype(np.float32)
col=image.astype(np.float32)
if bg.min()>130 and bg.max()-bg.min()<55:
    semi=(q>.04)&(q<.98)&(col.min(axis=2)>135)&((col.max(axis=2)-col.min(axis=2))<45)
    unmixed=(col-(1-q[:,:,None])*bg)/np.maximum(q[:,:,None],.04)
    col[semi]=unmixed[semi].clip(0,255)
result=np.dstack([col.astype(np.uint8),np.round(q*255).astype(np.uint8)])
ys,xs=np.where(q>.02)
result=result[max(0,ys.min()-4):min(h,ys.max()+5),max(0,xs.min()-4):min(w,xs.max()+5)]
if not cv2.imwrite(target,result):raise ValueError('Freistellung nicht gespeichert')
