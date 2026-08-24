// A-Frame exposes THREE as a browser global at runtime. The application uses
// that global directly rather than importing the package, so provide the small
// ambient type surface referenced by component signatures.
declare namespace THREE {
  type Vector3 = any;
  type Object3D = any;
  type Quaternion = any;
}
