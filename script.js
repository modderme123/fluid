import swal from "sweetalert";
import { readFileSync } from 'fs';
import Regl from 'regl';

const regl = Regl({
	attributes: {
		alpha: false,
		depth: false,
		stencil: false,
		antialias: false
	},
	extensions: ['OES_texture_half_float', 'OES_texture_half_float_linear']
});

const config = {
	TEXTURE_DOWNSAMPLE: 1,
	DENSITY_DISSIPATION: 0.98,
	VELOCITY_DISSIPATION: 0.99,
	PRESSURE_DISSIPATION: 0.8,
	PRESSURE_ITERATIONS: 25,
	SPLAT_RADIUS: 0.0012
};

let doubleFbo = (filter) => {
	let fbos = [createFbo(filter), createFbo(filter)];
	return {
		get read() {
			return fbos[0];
		},
		get write() {
			return fbos[1];
		},
		swap() {
			fbos.reverse();
		}
	};
};

let createFbo = (filter) => {
	return regl.framebuffer({
		color: regl.texture({
			width: window.innerWidth >> config.TEXTURE_DOWNSAMPLE,
			height: window.innerHeight >> config.TEXTURE_DOWNSAMPLE,
			wrap: 'clamp',
			min: filter,
			mag: filter,
			type: 'half float'
		}),
		depthStencil: false
	});
};

const velocity = doubleFbo('linear');
const density = doubleFbo('linear');
const pressure = doubleFbo('nearest');
const divergenceTex = createFbo('nearest');

const fullscreenDraw = {
	vert: readFileSync(`${__dirname}/shaders/project.vert`, 'utf8'),
	attributes: {
		points: [1, 1, 1, -1, -1, -1, 1, 1, -1, -1, -1, 1]
	},
	count: 6
};

const texelSize = ({ viewportWidth, viewportHeight }) => [1 / viewportWidth, 1 / viewportHeight];
const viewport = {
	x: 0,
	y: 0,
	width: window.innerWidth >> config.TEXTURE_DOWNSAMPLE,
	height: window.innerHeight >> config.TEXTURE_DOWNSAMPLE,
};
const advect = regl(Object.assign({
	frag: readFileSync(`${__dirname}/shaders/advect.frag`, 'utf8'),
	framebuffer: regl.prop("framebuffer"),
	uniforms: {
		timestep: 0.017,
		dissipation: regl.prop("dissipation"),
		x: regl.prop("x"),
		velocity: () => velocity.read,
		texelSize,
	},
	viewport
}, fullscreenDraw));
const divergence = regl(Object.assign({
	frag: readFileSync(`${__dirname}/shaders/divergence.frag`, 'utf8'),
	framebuffer: divergenceTex,
	uniforms: {
		velocity: () => velocity.read,
		texelSize,
	},
	viewport
}, fullscreenDraw));
const clear = regl(Object.assign({
	frag: readFileSync(`${__dirname}/shaders/clear.frag`, 'utf8'),
	framebuffer: () => pressure.write,
	uniforms: {
		pressure: () => pressure.read,
		dissipation: config.PRESSURE_DISSIPATION,
	},
	viewport
}, fullscreenDraw));
const gradientSubtract = regl(Object.assign({
	frag: readFileSync(`${__dirname}/shaders/gradientSubtract.frag`, 'utf8'),
	framebuffer: () => velocity.write,
	uniforms: {
		pressure: () => pressure.read,
		velocity: () => velocity.read,
		texelSize,
	},
	viewport
}, fullscreenDraw));
const display = regl(Object.assign({
	frag: readFileSync(`${__dirname}/shaders/display.frag`, 'utf8'),
	uniforms: {
		density: () => density.read,
	}
}, fullscreenDraw));
const splat = regl(Object.assign({
	frag: readFileSync(`${__dirname}/shaders/splat.frag`, 'utf8'),
	framebuffer: regl.prop("framebuffer"),
	uniforms: {
		uTarget: regl.prop("uTarget"),
		aspectRatio: ({ viewportWidth, viewportHeight }) => viewportWidth / viewportHeight,
		point: regl.prop("point"),
		color: regl.prop("color"),
		radius: config.SPLAT_RADIUS,
		density: () => density.read
	},
	viewport
}, fullscreenDraw));
const jacobi = regl(Object.assign({
	frag: readFileSync(`${__dirname}/shaders/jacobi.frag`, 'utf8'),
	framebuffer: () => pressure.write,
	uniforms: {
		pressure: () => pressure.read,
		divergence: () => divergenceTex,
		texelSize,
	},
	viewport
}, fullscreenDraw));
function createSplat(x, y, dx, dy, color) {
	splat({
		framebuffer: velocity.write,
		uTarget: velocity.read,
		point: [x / window.innerWidth, 1 - y / window.innerHeight],
		color: [dx, -dy, 1],
	});
	velocity.swap();

	splat({
		framebuffer: density.write,
		uTarget: density.read,
		point: [x / window.innerWidth, 1 - y / window.innerHeight],
		color
	});
	density.swap();
}

function Nueva() {
	const color = [0.0, 0.2, 0.5];

	for (let i = 0.8; i > 0.2; i -= 0.05) {
		createSplat(0.4 * window.innerWidth, i * window.innerHeight, 0, 0, color);
		createSplat(0.6 * window.innerWidth, i * window.innerHeight, 0, 0, color);
	}

	for (let i = -0.1; i <= 0.1; i += 0.0125) {
		createSplat((i + 0.5) * window.innerWidth, (i * 3 + 0.5) * window.innerHeight, 0, 0, color);
	}
}

regl.frame(() => {
	Nueva();
	if (pointer.moved) {
		createSplat(pointer.x, pointer.y, pointer.dx, pointer.dy, pointer.color);
		pointer.moved = false;
	}

	advect({
		framebuffer: velocity.write,
		x: velocity.read,
		dissipation: config.VELOCITY_DISSIPATION,
	});
	velocity.swap();

	advect({
		framebuffer: density.write,
		x: density.read,
		dissipation: config.DENSITY_DISSIPATION,
	});
	density.swap();

	divergence();

	clear();
	pressure.swap();

	for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
		jacobi();
		pressure.swap();
	}

	gradientSubtract();
	velocity.swap();

	display();
});
let pointer = {
	x: 0,
	y: 0,
	dx: 0,
	dy: 0,
	down: false,
	moved: false,
	color: [30, 0, 300]
};
document.addEventListener("mousemove", (e) => {
	pointer.moved = pointer.down;
	pointer.dx = (e.clientX - pointer.x) * 10;
	pointer.dy = (e.clientY - pointer.y) * 10;
	pointer.x = e.clientX;
	pointer.y = e.clientY;
});
document.addEventListener('mousedown', () => {
	pointer.down = true;
	pointer.color = [Math.random() + 0.2, Math.random() + 0.2, Math.random() + 0.2];
});
window.addEventListener('mouseup', () => {
	pointer.down = false;
});

window.dialogue = () => {
	swal("How I created this project",
		`The simulation is a model of what would happen if you put dye in water and stirred it around.
        A similar model is also applicable to smoke.
        
        I have seen multiple fluid simulations of navier stokes equations and wanted to make my own
        I have done a couple of projects with webgl and found it a fun challenge
        I really like how the fluid simulations I'd seen looked

        Fluid was more complex than many other things I had done, and paired nicely with webgl because webgl can use textures to simulate vector fields split across multiple gpu cores.
        
        The N in the fluid symbolizes how Nueva is flexible, and can adapt to changes`);
};
window.dialogue();
