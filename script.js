const canvas = document.querySelector("canvas");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const params = { alpha: false, depth: false, stencil: false, antialias: false };
const igloo = new Igloo(canvas, params);
const gl = igloo.gl;
const quad = igloo.array(Igloo.QUAD2);

const config = {
    TEXTURE_DOWNSAMPLE: 1,
    DENSITY_DISSIPATION: 0.98,
    VELOCITY_DISSIPATION: 0.99,
    PRESSURE_DISSIPATION: 0.8,
    PRESSURE_ITERATIONS: 25,
    CURL: 30,
    SPLAT_RADIUS: 0.0012
};

const splatProgram = igloo.program("shaders/project.vert", "shaders/splat.frag").attrib("points", quad, 2);
const advectProgram = igloo.program("shaders/project.vert", "shaders/advect.frag").attrib("points", quad, 2);
const jacobiProgram = igloo.program("shaders/project.vert", "shaders/jacobi.frag").attrib("points", quad, 2);
const divergenceProgram = igloo.program("shaders/project.vert", "shaders/divergence.frag").attrib("points", quad, 2);
const clearProgram = igloo.program("shaders/project.vert", "shaders/clear.frag").attrib("points", quad, 2);
const gradientSubtractProgram = igloo.program("shaders/project.vert", "shaders/gradientSubtract.frag").attrib("points", quad, 2);
const displayProgram = igloo.program("shaders/project.vert", "shaders/display.frag").attrib("points", quad, 2);

const ext = gl.getExtension('OES_texture_half_float');
gl.getExtension('OES_texture_half_float_linear');

let widthDownsample = canvas.width >> config.TEXTURE_DOWNSAMPLE;
let heightDownsample = canvas.width >> config.TEXTURE_DOWNSAMPLE;

let createFBO = (index, filter) => {
    gl.activeTexture(gl.TEXTURE0 + index);
    const texture = igloo.texture(null, gl.RGBA, gl.CLAMP_TO_EDGE, filter, ext.HALF_FLOAT_OES);
    texture.blank(widthDownsample, heightDownsample);
    const framebuffer = igloo.framebuffer(texture);
    return {
        get reader() {
            return texture;
        },
        get writer() {
            return framebuffer;
        },
        get index() {
            return index;
        }
    };
};

let doubleFbo = (index, filter) => {
    let fbo1 = createFBO(index    , filter);
    let fbo2 = createFBO(index + 1, filter);

    return {
        get first() {
            return fbo1;
        },
        get reader() {
            return fbo1.index;
        },
        get second() {
            return fbo2;
        },
        get writer() {
            return fbo2.writer;
        },
        swap() {
            [fbo1, fbo2] = [fbo2, fbo1];
        }
    };
};

const velocity = doubleFbo(0, gl.LINEAR);
const density = doubleFbo(2, gl.LINEAR);
const pressure = doubleFbo(4, gl.NEAREST);
const divergence = createFBO(6, gl.NEAREST);

[advectProgram, jacobiProgram, divergenceProgram, gradientSubtractProgram].forEach((x) => {
    x.use().uniform("texelSize", [1 / widthDownsample, 1 / heightDownsample]);
});

let lastTime = Date.now();
function draw() {    
    const tick = (Date.now() - lastTime) / 1000;
    lastTime = Date.now();

    gl.viewport(0, 0, widthDownsample, heightDownsample);

    Nueva();
    if (pointer.moved) {
        splat(pointer.x, pointer.y, pointer.dx, pointer.dy, pointer.color);
        pointer.moved = false;
    }
    
    velocity.writer.bind();
    advectProgram.use()
        .uniformi("velocity", velocity.reader)
        .uniformi("x", velocity.reader)
        .uniform("timestep", tick)
        .uniform("dissipation", config.VELOCITY_DISSIPATION)
        .draw(gl.TRIANGLE_STRIP, 4);
    velocity.swap();

    density.writer.bind();
    advectProgram // because this program was already bound, you only need to specify uniforms that change
        .uniformi("x", density.reader)
        .uniform("dissipation", config.DENSITY_DISSIPATION)
        .draw(gl.TRIANGLE_STRIP, 4);  
    density.swap();

    divergence.writer.bind();
    divergenceProgram.use()
        .uniformi("velocity", velocity.reader)
        .draw(gl.TRIANGLE_STRIP, 4);

    pressure.writer.bind();
    clearProgram.use()
        .uniformi("pressure", pressure.reader)
        .uniform("dissipation", config.PRESSURE_DISSIPATION)
        .draw(gl.TRIANGLE_STRIP, 4);
    pressure.swap();

    jacobiProgram.use()
        .uniformi("pressure", pressure.reader)
        .uniformi("divergence", divergence.index)
        .uniform("alpha", -1);
    gl.activeTexture(gl.TEXTURE0 + pressure.first.index);
    for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
        pressure.first.reader.bind();
        pressure.second.writer.bind();
        jacobiProgram.draw(gl.TRIANGLE_STRIP, 4);
        pressure.swap();
    }
    pressure.first.reader.bind(pressure.first.index); // Reset the swaps in case PRESSURE_ITERATIONS is an even number

    velocity.writer.bind();
    gradientSubtractProgram.use()
        .uniformi("pressure", pressure.reader)
        .uniformi("velocity", velocity.reader)
        .draw(gl.TRIANGLE_STRIP, 4);
    velocity.swap();

    gl.viewport(0, 0, canvas.width, canvas.height);

    igloo.defaultFramebuffer.bind();
    displayProgram.use()
        .uniformi("density", density.reader)
        .draw(gl.TRIANGLE_STRIP, 4);
    
    window.requestAnimationFrame(draw);
}
window.requestAnimationFrame(draw);

function Nueva() {
    const color = [0.0, 0.2, 0.5];

    for (let i = 0.8; i > 0.2; i -= 0.05) {
        splat(0.4 * canvas.width, i * canvas.height, 0, 0, color);
        splat(0.6 * canvas.width, i * canvas.height, 0, 0, color);        
    }

    for (let i = -0.1; i <= 0.1; i += 0.0125) {
        splat((i + 0.5) * canvas.width, (i * 3 + 0.5) * canvas.height, 0, 0, color);
    }
}

function splat(x,y,dx,dy,color){
    velocity.writer.bind();
    splatProgram.use()
        .uniformi("uTarget", velocity.reader)
        .uniform("aspectRatio", canvas.width / canvas.height)
        .uniform("point", [x / canvas.width, 1 - y / canvas.height])
        .uniform("color", [dx, -dy, 1])
        .uniform("radius", config.SPLAT_RADIUS)
        .draw(gl.TRIANGLE_STRIP, 4);
    velocity.swap();

    density.writer.bind();
    splatProgram.use()
        .uniformi("uTarget", density.reader)
        .uniform("color", color)
        .draw(gl.TRIANGLE_STRIP, 4);
    density.swap();
}
window.addEventListener("resize", () => {
    gl.viewport(0, 0, window.innerWidth, window.innerHeight);
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});
let pointer = {
    id: -1,
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    down: false,
    moved: false,
    color: [30, 0, 300]
};
canvas.addEventListener("mousemove", (e) => {
    pointer.moved = pointer.down;
    pointer.dx = (e.offsetX - pointer.x) * 10;
    pointer.dy = (e.offsetY - pointer.y) * 10;
    pointer.x = e.offsetX;
    pointer.y = e.offsetY;
});
canvas.addEventListener('mousedown', () => {
    pointer.down = true;
    pointer.color = [Math.random() + 0.2, Math.random() + 0.2, Math.random() + 0.2];
});
window.addEventListener('mouseup', () => {
    pointer.down = false;
});
