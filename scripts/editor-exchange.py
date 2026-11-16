"""Optional pixel-layer exchange and inspected derivatives; never adopt artwork."""

import base64
import copy
import hashlib
import json
import os
import re
import subprocess
import sys
import tarfile
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

root = Path(__file__).resolve().parent.parent
project = os.environ.get("MANGA_PROJECT")
assert project, "Select MANGA_PROJECT explicitly"
config_path = (root / project).resolve()
assert config_path.is_relative_to(root)
config_bytes = config_path.read_bytes()
config = json.loads(config_bytes)
config_hash = hashlib.sha256(config_bytes).hexdigest()
mode, name, spec_file = sys.argv[1:4]
assert name and all(c.isascii() and (c.isalnum() or c in "-_") for c in name), (
    "Invalid output name"
)
out = (root / config["workflowDir"] / "assistance" / name).resolve()
assert out.is_relative_to(config_path.parent) and not out.exists(), (
    "Output must be new and within selected work"
)


def sha(p):
    digest = hashlib.sha256()
    with p.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1048576), b""):
            digest.update(chunk)
    return digest.hexdigest()


def local(value):
    assert isinstance(value, str) and not Path(value).is_absolute(), (
        "Use workspace-relative files"
    )
    p = (root / value).resolve()
    assert p.is_relative_to(root) and p.is_file(), "Invalid input path"
    return p


spec_bytes = local(spec_file).read_bytes()
spec = json.loads(spec_bytes)
inputs = {spec_file: hashlib.sha256(spec_bytes).hexdigest()}


def image(file, budget=25000000):
    data = local(file).read_bytes()
    inputs[file] = hashlib.sha256(data).hexdigest()
    with Image.open(BytesIO(data)) as im:
        assert im.format == "PNG", "Expected PNG"
        size(list(im.size))
        assert im.width * im.height <= budget, "PSD layer pixel budget exceeded"
        im.load()
        return im.convert("RGBA")


def size(value):
    assert (
        isinstance(value, list)
        and len(value) == 2
        and all(type(v) is int and 0 < v <= 10000 for v in value)
    ), "Invalid size"
    assert value[0] * value[1] <= 25000000, "Image pixel budget exceeded"
    return tuple(value)


pending = {}
text_files = {}
metadata = {}
if mode == "edit":
    original = image(spec["source"])
    edited = original.copy()
    allowed = Image.new("L", original.size, 0)
    operations = spec["operations"]
    assert isinstance(operations, list) and 1 <= len(operations) <= 100, (
        "Provide 1 to 100 explicit edit operations"
    )
    assert isinstance(spec.get("reason"), str) and spec["reason"].strip(), (
        "Record the correction reason"
    )
    for operation in operations:
        rect = operation["rect"]
        assert (
            isinstance(rect, list)
            and len(rect) == 4
            and all(type(v) is int for v in rect)
        ), "Use integer [x,y,width,height]"
        x, y, w, h = rect
        assert (
            min(x, y) >= 0
            and min(w, h) > 0
            and x + w <= edited.width
            and y + h <= edited.height
        ), "Edit outside image"
        bounds = (x, y, x + w, y + h)
        kind = operation["kind"]
        if kind == "white":
            patch = edited.crop(bounds)
            edge = [
                patch.crop(box)
                for box in [
                    (0, 0, w, 1),
                    (0, h - 1, w, h),
                    (0, 0, 1, h),
                    (w - 1, 0, w, h),
                ]
            ]
            assert all(e.getextrema() == ((255, 255),) * 4 for e in edge), (
                "White erase requires an opaque white perimeter; "
                "use a smaller explicit region or another repair method"
            )
            patch = Image.new("RGBA", (w, h), "white")
        elif kind == "alpha":
            value = operation["value"]
            assert type(value) is int and 0 <= value <= 255, (
                "Alpha must be an integer from 0 to 255"
            )
            base = (
                image(operation["restoreFrom"])
                if "restoreFrom" in operation
                else edited
            )
            assert base.size == edited.size, "Restoration image dimensions differ"
            patch = base.crop(bounds)
            patch.putalpha(value)
        else:
            raise ValueError("Supported edits: white, alpha")
        edited.paste(patch, (x, y))
        ImageDraw.Draw(allowed).rectangle((x, y, x + w - 1, y + h - 1), fill=255)
    diff = ImageChops.difference(original, edited)
    changed = ImageChops.lighter(
        ImageChops.lighter(diff.getchannel("R"), diff.getchannel("G")),
        ImageChops.lighter(diff.getchannel("B"), diff.getchannel("A")),
    ).point(lambda v: 255 if v else 0)
    outside = ImageChops.multiply(changed, ImageChops.invert(allowed))
    assert outside.getbbox() is None, "Edit changed pixels outside requested regions"
    pending.update(
        {
            "before.png": original,
            "edited.png": edited,
            "changed.png": changed,
            "edited-quarter.png": edited.resize(
                (max(1, round(edited.width / 4)), max(1, round(edited.height / 4))),
                Image.Resampling.LANCZOS,
            ),
        }
    )
    for file, digest in inputs.items():
        assert sha(local(file)) == digest, "Input changed during edit"
    metadata = {
        "size": edited.size,
        "operations": operations,
        "reason": spec["reason"],
        "changedPixels": changed.histogram()[255],
        "outsideRequestedRegionsChangedPixels": 0,
        "sourceUnchanged": True,
        "inspectionRequired": [
            "normal and quarter scale",
            "white repair does not remove intended marks",
            "alpha restore uses correct original colours",
            "faces, hands, props and text",
        ],
        "generativeRepairPerformed": False,
    }
elif mode == "anthology":
    completions = spec["completions"]
    assert (
        isinstance(completions, list)
        and 1 <= len(completions) <= 32
        and len(set(completions)) == len(completions)
    )
    front = spec.get("frontMatter", 3)
    assert type(front) is int and 0 <= front <= 100
    offset = front + 1
    chapters = []
    for completion_file in completions:
        p = local(completion_file)
        inputs[completion_file] = sha(p)
        completion_bytes = p.read_bytes()
        inputs[completion_file] = hashlib.sha256(completion_bytes).hexdigest()
        completion = json.loads(completion_bytes)
        assert completion["status"] == "complete", "Reuse completed works only"
        deliverables = completion["deliverables"]
        archives = [n for n in deliverables if n.endswith(".tar.gz")]
        assert len(archives) == 1
        archive = local(archives[0])
        assert sha(archive) == deliverables[archives[0]], "Completed archive changed"
        inputs[archives[0]] = deliverables[archives[0]]
        config_member = str(Path(completion_file).parent / "workflow.json").replace(
            "\\", "/"
        )
        expected = {n: h for n, h in deliverables.items() if n != archives[0]}
        seen = set()
        frozen = None
        with tarfile.open(archive, "r|gz") as bundle:
            for member in bundle:
                if member.name not in expected and member.name != config_member:
                    continue
                assert member.isfile() and member.name not in seen, (
                    "Invalid archive member"
                )
                seen.add(member.name)
                stream = bundle.extractfile(member)
                assert stream is not None
                if member.name == config_member:
                    assert member.size <= 8000000, "Frozen config too large"
                    data = stream.read()
                    frozen = json.loads(data)
                    if member.name in expected:
                        assert hashlib.sha256(data).hexdigest() == expected[member.name]
                else:
                    digest = hashlib.sha256()
                    for chunk in iter(lambda: stream.read(1048576), b""):
                        digest.update(chunk)
                    assert digest.hexdigest() == expected[member.name], (
                        "Saved deliverable changed"
                    )
        assert frozen and set(expected).issubset(seen), (
            "Missing frozen config or deliverable"
        )
        ids = [page["id"] for page in frozen["pages"]]
        assert ids and len(set(ids)) == len(ids)
        chapters.append(
            {
                "title": frozen.get("title"),
                "author": frozen.get("author"),
                "completion": completion_file,
                "archive": archives[0],
                "archiveSHA256": deliverables[archives[0]],
                "pageIds": ids,
                "firstVolumePage": offset,
                "lastVolumePage": offset + len(ids) - 1,
            }
        )
        offset += len(ids)
    metadata = {
        "chapters": chapters,
        "frontMatter": front,
        "totalPlannedPages": offset - 1,
        "readingDirection": "right-to-left",
        "cover": "Separate cover and rights review required",
        "kindleCreateImportPerformed": False,
        "KPFGenerated": False,
        "fullImageReviewPerformed": False,
        "instruction": (
            "Reuse frozen saved exports. "
            "Verify exact chapter/cover/metadata/permissions "
            "and current publishing requirements before import or publication."
        ),
    }
elif mode == "mask":
    original = image(spec["source"])
    candidate = image(spec["candidate"])
    assert original.size == candidate.size, "Mask dimensions changed"
    alpha = candidate.getchannel("A")
    hist = alpha.histogram()
    diff = ImageChops.difference(original.convert("RGB"), candidate.convert("RGB"))
    opaque_changes = sum(
        1 for rgb, a in zip(diff.getdata(), alpha.getdata()) if a == 255 and any(rgb)
    )
    pending["alpha.png"] = alpha
    for label, color in [
        ("white", (255, 255, 255, 255)),
        ("magenta", (255, 0, 255, 255)),
    ]:
        combined = Image.alpha_composite(
            Image.new("RGBA", candidate.size, color), candidate
        )
        pending[label + ".png"] = combined
        pending[label + "-quarter.png"] = combined.resize(
            (max(1, round(combined.width / 4)), max(1, round(combined.height / 4))),
            Image.Resampling.LANCZOS,
        )
    metadata = {
        "size": candidate.size,
        "transparentPixels": hist[0],
        "partialAlphaPixels": sum(hist[1:255]),
        "opaquePixels": hist[255],
        "changedRGBAtOpaquePixels": opaque_changes,
        "usableMask": None,
        "inspectionRequired": [
            "specified people and props",
            "hair and boundary halo",
            "interior holes and partial alpha",
            "normal and quarter scale",
        ],
        "hiddenBackgroundRecovered": False,
    }
elif mode == "fit":
    source = image(spec["source"])
    target = size(spec["size"])
    method = spec["method"]
    assert method in ["contain", "crop"]
    assert isinstance(spec.get("reason"), str) and spec["reason"].strip(), (
        "State why format conversion is needed"
    )
    scale = (min if method == "contain" else max)(
        target[0] / source.width, target[1] / source.height
    )
    scaled_size = (
        max(1, round(source.width * scale)),
        max(1, round(source.height * scale)),
    )
    size(list(scaled_size))
    scaled = source.resize(
        scaled_size,
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", target, "white")
    canvas.alpha_composite(
        scaled, ((target[0] - scaled.width) // 2, (target[1] - scaled.height) // 2)
    )
    pending["fitted.png"] = canvas
    metadata = {
        "originalSize": source.size,
        "size": target,
        "method": method,
        "scale": scale,
        "reason": spec["reason"],
        "contentMayBeCropped": method == "crop",
        "inspectionRequired": ["faces, text and actions", "actual reader dimensions"],
        "kindleRequiredAspect": False,
    }
elif mode == "layout":
    page = next((p for p in config["pages"] if p["id"] == spec["page"]), None)
    assert page, "Unknown page"
    source = str(Path(config["outputDir"]) / f"page-{page['id']}.svg")
    file = local(source)
    source_bytes = file.read_bytes()
    inputs[source] = hashlib.sha256(source_bytes).hexdigest()
    tree = ET.ElementTree(ET.fromstring(source_bytes))
    original = tree.getroot()
    ns = "http://www.w3.org/2000/svg"

    def tag(name):
        return "{" + ns + "}" + name

    ET.register_namespace("", ns)
    for element in original.iter():
        assert element.tag.split("}")[-1] in [
            "svg",
            "defs",
            "image",
            "rect",
            "use",
            "clipPath",
            "path",
            "text",
            "tspan",
            "g",
            "circle",
            "polygon",
            "line",
        ], "Unsupported SVG element"
        for key, value in element.attrib.items():
            assert not key.lower().startswith("on"), "Event handler not allowed"
            if key.split("}")[-1] == "href":
                assert value.startswith("#") or value.startswith(
                    "data:image/png;base64,"
                ), "External SVG resource not allowed"
    children = list(original)
    arts = [i for i, e in enumerate(children) if e.tag in [tag("svg"), tag("image")]]
    assert len(arts) == len(page["panels"]), (
        "Expected one standalone artwork group per panel"
    )
    assert children[-1].tag == tag("text") and children[-1].get("y") == "1500", (
        "Unexpected page footer"
    )
    footer = children[-1]
    groups = [
        children[start : (arts[i + 1] if i + 1 < len(arts) else len(children) - 1)]
        for i, start in enumerate(arts)
    ]
    snapshot = spec.get("sourceSnapshotOnly", False)
    assert type(snapshot) is bool
    if not snapshot:
        status = subprocess.run(
            [os.environ.get("MANGA_NODE", "node"), "cli/workflow.mjs", "status"],
            cwd=root,
            env=os.environ,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        assert status.returncode == 0 and re.search(
            r"^" + re.escape(page["id"]) + r": ready$", status.stdout, re.M
        ), (
            "Page is not ready; use an explicit independent "
            "sourceSnapshotOnly candidate if needed"
        )
        expected_text = "".join(
            "".join(d["text"].replace("\n", "") for d in p["dialogue"])
            + "".join(e["text"] for e in p.get("soundEffects", []))
            for p in page["panels"]
        ) + str(int(page["id"]))
        actual_text = "".join("".join(e.itertext()) for e in original.iter(tag("text")))
        assert actual_text == expected_text, (
            "Saved SVG text differs from current script"
        )
        assert config.get("renderMode") == "panels", (
            "Page-mode output requires explicit independent sourceSnapshotOnly handling"
        )
        embedded = [
            hashlib.sha256(
                base64.b64decode(e.get("href").split(",", 1)[1], validate=True)
            ).hexdigest()
            for e in original.iter(tag("image"))
        ]
        current = []
        for panel in page["panels"]:
            material = str(
                Path(config["assetDir"]) / "panels" / f"{panel['id']}.png"
            ).replace("\\", "/")
            inputs[material] = sha(local(material))
            current.append(inputs[material])
        assert embedded == current, "Saved SVG artwork differs from current materials"
    variant = spec["variant"]
    assert variant in ["equal", "title", "frameless", "diagonal", "edge"]
    if variant in ["equal", "title"]:
        assert len(groups) == 4, "Equal/title layout is a four-panel candidate only"
    if variant == "title":
        assert isinstance(spec.get("title"), str) and spec["title"].strip()
    rendered = ET.Element(original.tag, dict(original.attrib))
    for node in children[: arts[0]]:
        rendered.append(copy.deepcopy(node))
    metrics = []
    if variant == "title":
        title = ET.SubElement(
            rendered,
            tag("text"),
            {
                "x": "512",
                "y": "86",
                "text-anchor": "middle",
                "font-family": "Yu Gothic,Meiryo,sans-serif",
                "font-size": "44",
            },
        )
        title.text = spec["title"]
    for i, (group, panel) in enumerate(zip(groups, page["panels"])):
        frames = [
            e
            for e in group
            if e.tag == tag("rect")
            and e.get("fill") == "none"
            and e.get("stroke-width") == "3"
        ]
        assert len(frames) == 1, "Unexpected frame structure"
        frame = frames[0]
        x, y, w, h = panel["rect"]
        assert [float(frame.get(k)) for k in ["x", "y", "width", "height"]] == panel[
            "rect"
        ], "Frame/config mismatch"
        wrapper = ET.SubElement(rendered, tag("g"))
        scale = 1
        if variant in ["equal", "title"]:
            top, row_h = (24, 346) if variant == "equal" else (136, 318)
            scale = min(1, 976 / w, row_h / h)
            slot_y = top + i * (row_h + 12)
            tx = 24 + (976 - w * scale) / 2 - x * scale
            ty = slot_y + (row_h - h * scale) / 2 - y * scale
            wrapper.set("transform", f"matrix({scale},0,0,{scale},{tx},{ty})")
            for node in group:
                if node is not frame:
                    wrapper.append(copy.deepcopy(node))
            ET.SubElement(
                rendered,
                tag("rect"),
                {
                    "x": "24",
                    "y": str(slot_y),
                    "width": "976",
                    "height": str(row_h),
                    "fill": "none",
                    "stroke": "black",
                    "stroke-width": "3",
                },
            )
        else:
            if variant == "edge":
                wrapper.set(
                    "transform", f"translate({(-x if x < 512 else 1024 - x - w)},0)"
                )
            if variant == "diagonal":
                points = (
                    f"{x},{y + min(32, h / 10)} {x + w},{y} "
                    f"{x + w},{y + h - min(32, h / 10)} {x},{y + h}"
                )
                defs = ET.SubElement(wrapper, tag("defs"))
                clip = ET.SubElement(
                    defs, tag("clipPath"), {"id": f"candidate-clip-{i}"}
                )
                ET.SubElement(clip, tag("polygon"), {"points": points})
                wrapper.set("clip-path", f"url(#candidate-clip-{i})")
            for node in group:
                if node is not frame or variant == "edge":
                    wrapper.append(copy.deepcopy(node))
            if variant == "diagonal":
                ET.SubElement(
                    rendered,
                    tag("polygon"),
                    {
                        "points": points,
                        "fill": "none",
                        "stroke": "black",
                        "stroke-width": "3",
                    },
                )
        metrics.append(
            {"panel": panel["id"], "scale": scale, "effectiveBodyFontSize": 26 * scale}
        )
    rendered.append(copy.deepcopy(footer))
    assert [e.get("href") for e in rendered.iter(tag("image"))] == [
        e.get("href") for e in original.iter(tag("image"))
    ], "Artwork data changed"
    text_files[f"page-{page['id']}.svg"] = ET.tostring(rendered, encoding="unicode")
    metadata = {
        "page": page["id"],
        "variant": variant,
        "metrics": metrics,
        "sourceSnapshotOnly": snapshot,
        "currentScriptAndArtworkMatched": not snapshot,
        "currentPlacementRecertified": False,
        "productionImportPerformed": False,
        "inspectionRequired": [
            "clipped faces/hair/text/actions",
            "normal and quarter-size readability",
            "unnumbered reading order",
            "front/back page context",
        ],
        "warning": (
            "Geometry-only candidate, not a validated replacement layout. "
            "Rebuild source rects/lettering/positions "
            "and rerun formal reviews before adoption."
        ),
    }
elif mode == "psd":
    from psd_tools import PSDImage

    dimensions = size(spec["size"])
    layers = spec["layers"]
    assert isinstance(layers, list) and 1 <= len(layers) <= 64
    psd = PSDImage.new(mode="RGB", size=dimensions, depth=8)
    expected = []
    remaining_pixels = 50000000
    for entry in layers:
        assert isinstance(entry.get("name"), str) and entry["name"].strip()
        pixels = image(entry["file"], remaining_pixels)
        remaining_pixels -= pixels.width * pixels.height
        left = entry.get("x", 0)
        top = entry.get("y", 0)
        assert type(left) is int and type(top) is int and min(left, top) >= 0
        assert (
            left + pixels.width <= dimensions[0]
            and top + pixels.height <= dimensions[1]
        ), "Layer outside document"
        visible = entry.get("visible", True)
        assert type(visible) is bool
        layer = psd.create_pixel_layer(pixels, name=entry["name"], left=left, top=top)
        layer.visible = visible
        expected.append((entry["name"], left, top, visible, pixels))
    out.mkdir(parents=True)
    file = out / "layers.psd"
    psd.save(file)
    reopened = PSDImage.open(file)
    assert reopened.size == dimensions and len(reopened) == len(expected)
    for layer, (label, left, top, visible, pixels) in zip(reopened, expected):
        assert (layer.name, layer.left, layer.top, layer.visible) == (
            label,
            left,
            top,
            visible,
        )
        actual = layer.topil().convert("RGBA")
        if layer.has_mask():
            assert not layer.mask.disabled
            mask = layer.mask.topil()
            assert mask.size == actual.size
            actual.putalpha(
                ImageChops.multiply(actual.getchannel("A"), mask.convert("L"))
            )
        assert actual.size == pixels.size and actual.tobytes() == pixels.tobytes(), (
            "Layer RGBA changed"
        )
    metadata = {
        "size": dimensions,
        "layers": len(layers),
        "decodedLayersVerified": True,
        "format": "8-bit RGB normal pixel layers only",
        "editableText": False,
        "characterBackgroundSeparationPerformed": False,
    }
elif mode == "unpack":
    from psd_tools import PSDImage
    from psd_tools.constants import BlendMode

    file = local(spec["source"])
    assert file.stat().st_size <= 268435456, "PSD file budget exceeded"
    psd_bytes = file.read_bytes()
    inputs[spec["source"]] = hashlib.sha256(psd_bytes).hexdigest()
    psd = PSDImage.open(BytesIO(psd_bytes))
    assert psd.color_mode.name == "RGB" and psd.depth == 8 and 1 <= len(psd) <= 64, (
        "Only RGB8 pixel PSD supported"
    )
    size(list(psd.size))
    assert sum(layer.width * layer.height for layer in psd) <= 50000000, (
        "PSD layer pixel budget exceeded"
    )
    canvas = Image.new("RGBA", psd.size)
    layers = []
    for i, layer in enumerate(psd):
        assert (
            layer.kind == "pixel"
            and layer.blend_mode == BlendMode.NORMAL
            and layer.opacity == 255
            and not layer.clipping
        ), "Unsupported PSD layer: " + layer.name
        assert (
            not layer.has_vector_mask()
            and not layer.has_effects()
            and layer.fill_opacity == 255
        ), "Unsupported PSD vector mask/effects/fill opacity: " + layer.name
        assert (
            layer.left >= 0
            and layer.top >= 0
            and layer.right <= psd.width
            and layer.bottom <= psd.height
        ), "Layer outside document"
        pixels = layer.topil().convert("RGBA")
        if layer.has_mask():
            assert not layer.mask.disabled and layer.mask.background_color == 0, (
                "Unsupported mask state"
            )
            assert (
                layer.mask.bbox == layer.bbox
                and not layer.mask.flags.pos_relative_to_layer
                and not layer.mask.flags.invert_mask
            ), "Unsupported mask alignment or inversion"
            parameters = layer.mask.parameters
            assert parameters is None or (
                parameters.user_mask_density in [None, 255]
                and parameters.user_mask_feather in [None, 0]
                and parameters.vector_mask_density is None
                and parameters.vector_mask_feather is None
            ), "Unsupported mask density or feather"
            mask = layer.mask.topil()
            assert mask.size == pixels.size, "Mask alignment requires manual handling"
            pixels.putalpha(
                ImageChops.multiply(pixels.getchannel("A"), mask.convert("L"))
            )
        name = f"layer-{i:02}.png"
        pending[name] = pixels
        layers.append(
            {
                "file": name,
                "name": layer.name,
                "x": layer.left,
                "y": layer.top,
                "visible": layer.visible,
            }
        )
        if layer.visible:
            canvas.alpha_composite(pixels, (layer.left, layer.top))
    pending["composite.png"] = canvas
    metadata = {
        "size": psd.size,
        "layers": layers,
        "editableText": False,
        "colourProfilePreserved": False,
        "productionImportPerformed": False,
    }
else:
    raise ValueError("Use mask, fit, psd or unpack")
out.mkdir(parents=True, exist_ok=mode == "psd")
for name, text in text_files.items():
    (out / name).write_text(text, encoding="utf-8")
for name, im in pending.items():
    file = out / name
    assert not file.exists()
    im.save(file)
    with Image.open(file) as saved:
        assert saved.size == im.size and saved.tobytes() == im.tobytes()
assert sha(config_path) == config_hash, "Canonical configuration changed"
result = {
    "optional": True,
    "productionAdopted": False,
    "readyToPublish": False,
    "mode": mode,
    "configHash": config_hash,
    "inputs": inputs,
    "result": metadata,
    "limits": [
        "No automatic production acceptance or release modification",
        "Inspect actual images and re-measure before adoption",
        "No CSP, vector, editable text or arbitrary PSD compatibility guarantee",
    ],
}
(out / "result.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
(out / "manifest.json").write_text(
    json.dumps(
        {
            "files": [
                {"file": p.name, "sha256": sha(p)} for p in out.iterdir() if p.is_file()
            ]
        },
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)
print(json.dumps({"directory": str(out), "mode": mode, "productionAdopted": False}))
