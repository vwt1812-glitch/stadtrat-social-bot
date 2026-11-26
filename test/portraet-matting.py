"""Run with the portrait Python: python test/portraet-matting.py."""
import importlib.util,pathlib,unittest
import cv2
import numpy as np
spec=importlib.util.spec_from_file_location('cutout',pathlib.Path(__file__).resolve().parents[1]/'src/portraet-freistellen.py')
cutout=importlib.util.module_from_spec(spec);spec.loader.exec_module(cutout)

class MattingTest(unittest.TestCase):
    def test_soft_edges_remove_background_colour(self):
        y,x=np.mgrid[:160,:160]
        alpha=np.clip((52-np.sqrt((x-80)**2+(y-80)**2))/3,0,1)
        colour=np.array([110,45,25.])  # BGR subject on a pale studio background
        image=np.round(alpha[:,:,None]*colour+(1-alpha[:,:,None])*235).astype(np.uint8)
        mask=cv2.GaussianBlur(alpha.astype(np.float32),(0,0),1)
        result=cutout.soft_cutout(image,mask)
        a=result[:,:,3]/255
        semi=(a>.1)&(a<.9)
        self.assertGreater(semi.sum(),100,'Soft edge pixels must survive')
        self.assertLess(float(result[:,:,:3][semi,2].mean()),55,'Remove the pale studio colour at the edge')
        center=result[result.shape[0]//2,result.shape[1]//2]
        np.testing.assert_array_equal(center,np.array([110,45,25,255]))

    def test_uncertain_mask_fails_instead_of_cutting_blindly(self):
        with self.assertRaisesRegex(ValueError,'eindeutige Person'):
            cutout.soft_cutout(np.zeros((60,60,3),np.uint8),np.full((60,60),.5,np.float32))

if __name__=='__main__':unittest.main()
