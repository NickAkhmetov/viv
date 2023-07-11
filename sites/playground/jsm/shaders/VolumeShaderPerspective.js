
import {
  Vector2,
  Vector3
} from "../../node_modules/three/build/three.module.js";

var VolumeRenderShaderPerspective = {
  uniforms: {
    "u_size": {value: new Vector3(1, 1, 1)},
    "u_renderstyle": {value: 0},
    "u_renderthreshold": {value: 0.5},
    "u_opacity": {value: 0.5},
    "u_clim": {value: new Vector2(0.2, 0.8)},
    "u_data": {value: null},
    "volumeTex": {value: null},
    "u_cmdata": {value: null},
    "near": {value: 0.1},
    "far": {value: 10000},
    "alphaScale": {value: 0},
    "dtScale": {value: 1},
    "finalGamma": {value: 0},
    "boxSize": {value: new Vector3(1,1,1)},
    "useVolumeMirrorX": { value: false },
  },
  vertexShader: [
    "out vec3 rayDirUnnorm;",

    "void main()",
    "{",
      "rayDirUnnorm = position - cameraPosition;",
      "gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
    "}"
  ].join("\n"),
  fragmentShader: [
    "precision highp float;",
   " precision mediump sampler3D;",
    "in vec3 rayDirUnnorm;",
    "uniform sampler3D volumeTex;",
    "uniform sampler2D u_cmdata;",
    "uniform float alphaScale;",
    "uniform float dtScale;",
    "uniform float finalGamma;",
    "uniform highp vec3 boxSize;",
    "uniform bool useVolumeMirrorX;",
    "uniform vec2 u_clim;",
    "uniform vec3 u_size;",
    "vec4 apply_colormap(float val);",

    "vec2 intersect_hit(vec3 orig, vec3 dir) {",
    "  vec3 boxMin = vec3(-0.5) * boxSize;",
    "  vec3 boxMax = vec3( 0.5) * boxSize;",
    "  vec3 invDir = 1.0 / dir;",
    "  vec3 tmin0 = (boxMin - orig) * invDir;",
    "  vec3 tmax0 = (boxMax - orig) * invDir;",
    "  vec3 tmin = min(tmin0, tmax0);",
    "  vec3 tmax = max(tmin0, tmax0);",
    "  float t0 = max(tmin.x, max(tmin.y, tmin.z));",
    "  float t1 = min(tmax.x, min(tmax.y, tmax.z));",
    "  return vec2(t0, t1);",
    "}",
    "   // Pseudo-random number gen from",
    "   // http://www.reedbeta.com/blog/quick-and-easy-gpu-random-numbers-in-d3d11/",
    "   // with some tweaks for the range of values",
    "       float wang_hash(int seed) {",
    "     seed = (seed ^ 61) ^ (seed >> 16);",
    "     seed *= 9;",
    "     seed = seed ^ (seed >> 4);",
    "     seed *= 0x27d4eb2d;",
    "     seed = seed ^ (seed >> 15);",
    "     return float(seed % 2147483647) / float(2147483647);",
    "     }",
    "float linear_to_srgb(float x) {",
    "   if (x <= 0.0031308f) {",
    "     return 12.92f * x;",
    "   }",
    "   return 1.055f * pow(x, 1.f / 2.4f) - 0.055f;",
    "}",
    "void main(void) {",
    "  //STEP 1: Normalize the view Ray",
    "  vec3 rayDir = normalize(rayDirUnnorm);",
    "  //STEP 2: Intersect the ray with the volume bounds to find the interval along the ray overlapped by the volume",
    "  vec2 t_hit = intersect_hit(cameraPosition, rayDir);",
    "  if (t_hit.x >= t_hit.y) {",
    "    discard;",
    "  }",
    "  //No sample behind the eye",
    "  t_hit.x = max(t_hit.x, 0.0);",
    "  //STEP 3: Compute the step size to march through the volume grid",
    "  ivec3 volumeTexSize = textureSize(volumeTex, 0);",
    "  vec3 dt_vec = 1.0 / (vec3(volumeTexSize) * abs(rayDir));",
    "  float dt = min(dt_vec.x, min(dt_vec.y, dt_vec.z));",
    "  // Ray starting point, in the real space where the box may not be a cube.",
    "  // Prevents a lost WebGL context.",
    "   if (dt < 0.00001) {",
    "     gl_FragColor = vec4(0.0);",
    "     return;",
    "   }",
    " float offset = wang_hash(int(gl_FragCoord.x + 640.0 * gl_FragCoord.y));",
    " vec3 p = cameraPosition + (t_hit.x + offset*dt) * rayDir;",
    "  // Most browsers do not need this initialization, but add it to be safe.",
    "  gl_FragColor = vec4(0.0);",
    // For testing: show the number of steps. This helps to establish
    // whether the rays are correctly oriented
    "  p = p / boxSize + vec3(0.5);" +
    "  vec3 step = (rayDir * dt) / boxSize;",
    "  // ",
    "  // Initialization of some variables.",
    "	 float max_val = -1e6;",
    "  int max_i = 300;",
    "  int i = 0;",
    "  for (float t = t_hit.x; t < t_hit.y; t += dt) {",
    "      float val = texture(volumeTex, p.xyz).r;",
    // "      if(val > 0.2){",
    "      vec4 val_color = vec4(texture(u_cmdata, vec2(val, 0.5)).rgb, val);",
    "      gl_FragColor.rgb += (1.0 - gl_FragColor.a) * val_color.a * val_color.rgb;",
    "      gl_FragColor.a += (1.0 - gl_FragColor.a) * val_color.a;",
    // "      }",
    "      if (gl_FragColor.a >= 0.95) {",
    "         break;",
    "      }",
     "     p += step;",
    "  }",
    "    gl_FragColor.r = linear_to_srgb(gl_FragColor.r);",
    "    gl_FragColor.g = linear_to_srgb(gl_FragColor.g);",
    "    gl_FragColor.b = linear_to_srgb(gl_FragColor.b);",
    "}",
    ].join("\n")
};

export {VolumeRenderShaderPerspective};
