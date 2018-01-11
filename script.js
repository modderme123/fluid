import Regl from 'regl';
import vex from 'vex-js';

import "vex-js/dist/css/vex.css";
import "vex-js/dist/css/vex-theme-default.css";
vex.defaultOptions.className = "vex-theme-default";

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
	vert: require("raw-loader!./shaders/project.vert"),
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
	frag: require("raw-loader!./shaders/advect.frag"),
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
	frag: require("raw-loader!./shaders/divergence.frag"),
	framebuffer: divergenceTex,
	uniforms: {
		velocity: () => velocity.read,
		texelSize,
	},
	viewport
}, fullscreenDraw));
const clear = regl(Object.assign({
	frag: require("raw-loader!./shaders/clear.frag"),
	framebuffer: () => pressure.write,
	uniforms: {
		pressure: () => pressure.read,
		dissipation: config.PRESSURE_DISSIPATION,
	},
	viewport
}, fullscreenDraw));
const gradientSubtract = regl(Object.assign({
	frag: require("raw-loader!./shaders/gradientSubtract.frag"),
	framebuffer: () => velocity.write,
	uniforms: {
		pressure: () => pressure.read,
		velocity: () => velocity.read,
		texelSize,
	},
	viewport
}, fullscreenDraw));
const display = regl(Object.assign({
	frag: require("raw-loader!./shaders/display.frag"),
	uniforms: {
		density: () => density.read,
	}
}, fullscreenDraw));
const splat = regl(Object.assign({
	frag: require("raw-loader!./shaders/splat.frag"),
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
	frag: require("raw-loader!./shaders/jacobi.frag"),
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

vex.registerPlugin(require('vex-dialog'));
window.dialogue = () => {
	vex.dialog.alert({
		unsafeMessage: `<h1>Nueva Jets</h1>
		<h2>by Milo Mighdoll, 9th grade applicant</h2>
		<h3>** Click and drag your mouse to create fluid! **</h3>
		<p>The simulation is a model of what happens if you put dye in water and stir it around.</p>
		<p>The N in the fluid symbolizes how Nueva is flexible, and can adapt to changes</p>

		<h2>Why I wanted to make this project</h2>
		<p>I have seen multiple fluid simulations of Navier-Stokes equations and wanted to make my own. I have done a couple of projects with WebGL and found it a fun challenge. Fluid paired nicely with WebGL because WebGL can use textures to simulate vector fields split across multiple gpu cores.</p>

		<h2>You can view the source code on <a href="http://github.com/modderme123/fluid">Github</a></h2>
		<p>This project took me over three weeks to implement. I had selected <a href="http://github.com/skeeto/igloojs">Igloo</a> as a good WebGL library for this project. However, after finding Igloo slow, I went browsing for faster alternatives. This yielded <a href="http://regl.party">regl</a>, a better library for my purposes. </p>

		<p>If the site is slow, try using <a href="https://www.google.com/chrome/">Google Chrome</a></p>`,
	});
	document.querySelector(".vex").scrollTop = 0;
};
window.dialogue();
