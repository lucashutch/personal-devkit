#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6.0"]
# ///
"""Link repository-managed configuration described by links.yaml."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

from .program_installers.common import configure_logging, fail, info

PROFILE_NAMES = {
    "opencode",
    "opencode-test",
    # Retired profiles, kept only so a stale shell's roots still de-nest.
    "opencode-v1-test",
    "opencode-v2",
    "opencode-v2-test",
    "opencode-v1-home",
    "opencode-v1-work",
    "opencode-v2-home",
    "opencode-v2-work",
}
VARIABLE = re.compile(r"\$([A-Z_]+)")
DESKTOP_TEMPLATES = (
    "opencode.desktop.in",
    "ai.opencode.desktop.desktop.in",
)
GROUPS = ("opencode", "claude", "herdr", "dotfiles")


class HelpFormatter(argparse.RawTextHelpFormatter):
    def format_help(self) -> str:
        return super().format_help().replace("usage:", "Usage:", 1)


@dataclass(frozen=True)
class Link:
    group: str
    source: Path
    destination: Path


@dataclass(frozen=True)
class GeneratedFile:
    destination: Path
    content: str


def root() -> Path:
    for candidate in (Path.cwd().resolve(), *Path.cwd().resolve().parents):
        if (candidate / "links.yaml").is_file():
            return candidate
    source_root = Path(__file__).resolve().parents[2]
    if (source_root / "links.yaml").is_file():
        return source_root
    raise RuntimeError("could not find a personal-devkit repository")


def unprofile(path: Path) -> Path:
    return path.parent if path.name in PROFILE_NAMES else path


def variables() -> dict[str, str]:
    home = Path(os.environ.get("HOME", str(Path.home()))).expanduser().absolute()
    defaults = {
        "CONFIG_HOME": home / ".config",
        "DATA_HOME": home / ".local/share",
        "STATE_HOME": home / ".local/state",
        "CACHE_HOME": home / ".cache",
    }
    result = {"HOME": str(home)}
    for name, default in defaults.items():
        value = Path(os.environ.get("XDG_" + name, str(default))).expanduser().absolute()
        result[name] = str(unprofile(value))
    claude = os.environ.get("CLAUDE_CONFIG_DIR") or str(home / ".claude")
    result["CLAUDE_CONFIG_DIR"] = str(Path(claude).expanduser().absolute())
    return result


def expand(value: str, values: dict[str, str]) -> str:
    unknown = set(VARIABLE.findall(value)) - values.keys()
    if unknown or "$" in VARIABLE.sub("", value):
        raise ValueError(f"undefined or invalid variable in {value!r}")
    return VARIABLE.sub(lambda match: values[match.group(1)], value)


def path_matches(path: str, pattern: str) -> bool:
    """Match repository-relative POSIX paths with recursive, shell-like globs."""
    if "/" not in pattern:
        pattern = "**/" + pattern
    expression = ""
    index = 0
    while index < len(pattern):
        if pattern[index : index + 3] == "**/":
            expression += "(?:.*/)?"
            index += 3
        elif pattern[index : index + 2] == "**":
            expression += ".*"
            index += 2
        elif pattern[index] == "*":
            expression += "[^/]*"
            index += 1
        elif pattern[index] == "?":
            expression += "[^/]"
            index += 1
        else:
            expression += re.escape(pattern[index])
            index += 1
    if pattern.endswith("/**"):
        expression = expression.removesuffix("/.*") + "(?:/.*)?"
    return re.fullmatch(expression, path) is not None


def expand_filtered(
    group: str,
    source: Path,
    destination: Path,
    includes: list[str],
    excludes: list[str],
) -> list[Link]:
    def selected(relative: str) -> bool:
        return any(path_matches(relative, pattern) for pattern in includes) and not any(
            path_matches(relative, pattern) for pattern in excludes
        )

    def covers_subtree(relative: str) -> bool:
        if excludes:
            return False
        return "**" in includes or f"{relative}/**" in includes

    def visit(directory: Path, relative: Path) -> list[Link]:
        links: list[Link] = []
        entries = sorted(directory.iterdir(), key=lambda item: item.name)
        for child in entries:
            child_relative = relative / child.name
            child_name = child_relative.as_posix()
            if child.is_dir() and not child.is_symlink():
                if covers_subtree(child_name):
                    links.append(Link(group, child, destination / child_relative))
                else:
                    links.extend(visit(child, child_relative))
            elif selected(child_name):
                links.append(Link(group, child, destination / child_relative))
        if (
            not entries
            and not excludes
            and relative != Path()
            and selected(relative.as_posix())
        ):
            links.append(Link(group, directory, destination / relative))
        return links

    return visit(source, Path())


def build_plan(groups: set[str], manifest: Path | None = None) -> list[Link]:
    manifest = manifest or root() / "links.yaml"
    try:
        document = yaml.safe_load(manifest.read_text())
    except (OSError, yaml.YAMLError) as error:
        raise ValueError(f"could not read manifest: {error}") from error
    if (
        not isinstance(document, dict)
        or set(document) != {"version", "groups"}
        or document.get("version") != 1
        or not isinstance(document.get("groups"), dict)
    ):
        raise ValueError("manifest must have version: 1 and a groups mapping")
    invalid_manifest_groups = set(document["groups"]) - set(GROUPS)
    if invalid_manifest_groups:
        raise ValueError(
            f"unknown manifest groups: {', '.join(sorted(invalid_manifest_groups))}"
        )
    unknown_groups = groups - document["groups"].keys()
    if unknown_groups:
        raise ValueError(f"undefined groups: {', '.join(sorted(unknown_groups))}")
    values, plan = variables(), []
    for group in sorted(groups):
        entries = document["groups"][group]
        if not isinstance(entries, list):
            raise ValueError(f"group {group} must be a list")  # noqa: TRY004
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) - {
                "source",
                "destinations",
                "optional",
                "include",
                "exclude",
            }:
                raise ValueError(f"invalid entry in group {group}")
            if "optional" in entry and not isinstance(entry["optional"], bool):
                raise ValueError(f"optional must be a boolean in group {group}")
            source_value, destinations = entry.get("source"), entry.get("destinations")
            if (
                not isinstance(source_value, str)
                or not isinstance(destinations, list)
                or not destinations
                or not all(isinstance(value, str) for value in destinations)
            ):
                raise ValueError(f"invalid source/destinations in group {group}")
            source = Path(expand(source_value, values))
            if not source.is_absolute():
                source = root() / source
            source = Path(os.path.normpath(source.absolute()))
            if not source.exists():
                if entry.get("optional") is True:
                    continue
                raise ValueError(f"missing source: {source}")
            filtered = "include" in entry or "exclude" in entry
            for key in ("include", "exclude"):
                if key in entry and (
                    not isinstance(entry[key], list)
                    or not all(
                        isinstance(pattern, str)
                        and pattern
                        and "[" not in pattern
                        and "]" not in pattern
                        for pattern in entry[key]
                    )
                ):
                    raise ValueError(
                        f"{key} must contain non-empty *, **, ? glob strings in group {group}"
                    )
            if filtered and (not source.is_dir() or source.is_symlink()):
                raise ValueError(f"filters require a directory source: {source}")
            includes = entry.get("include", ["**"])
            excludes = entry.get("exclude", [])
            for value in destinations:
                destination = Path(expand(value, values))
                if not destination.is_absolute():
                    raise ValueError(f"destination must be absolute: {destination}")
                normalized_destination = Path(
                    os.path.normpath(destination.absolute())
                )
                if source == normalized_destination:
                    raise ValueError(f"source equals destination: {source}")
                if (
                    normalized_destination in source.parents
                    or source in normalized_destination.parents
                ):
                    raise ValueError(
                        f"dangerous source/destination nesting: {normalized_destination}"
                    )
                if filtered:
                    plan.extend(
                        expand_filtered(
                            group, source, normalized_destination, includes, excludes
                        )
                    )
                else:
                    plan.append(Link(group, source, normalized_destination))
    destinations: dict[Path, Link] = {}
    for link in plan:
        if link.source == link.destination:
            raise ValueError(f"source equals destination: {link.source}")
        if link.destination in destinations:
            raise ValueError(f"duplicate destination: {link.destination}")
        destinations[link.destination] = link
        if link.destination in link.source.parents or link.source in link.destination.parents:
            raise ValueError(f"dangerous source/destination nesting: {link.destination}")
    ordered = sorted(destinations)
    for index, destination in enumerate(ordered):
        for other in ordered[index + 1:]:
            if destination in other.parents:
                raise ValueError(f"conflicting parent/child destinations: {destination} and {other}")
    return plan


def immediate_symlink_target(path: Path) -> Path | None:
    if not path.is_symlink():
        return None
    target = Path(os.readlink(path))
    if not target.is_absolute():
        target = path.parent / target
    return Path(os.path.normpath(target.absolute()))


def matches(link: Link) -> bool:
    return immediate_symlink_target(link.destination) == link.source


def symlink_ancestor(path: Path) -> Path | None:
    for ancestor in path.parents:
        if ancestor.is_symlink():
            return ancestor
    return None


def preflight_links(
    plan: list[Link], *, force: bool, unlink: bool, check: bool
) -> tuple[list[Link], list[str]]:
    operations = []
    errors = []
    for link in plan:
        dst = link.destination
        ancestor = symlink_ancestor(dst)
        if ancestor is not None:
            errors.append(f"refusing to operate through symlink ancestor: {ancestor}")
            continue
        if check:
            if not matches(link):
                errors.append(f"incorrect: {dst}")
            continue
        if unlink:
            if matches(link):
                operations.append(link)
            elif dst.exists() or dst.is_symlink():
                errors.append(f"refusing to unlink unmanaged object: {dst}")
            continue
        if matches(link):
            continue
        if dst.exists() or dst.is_symlink():
            if not force:
                errors.append(f"already exists: {dst} (use --force to replace)")
                continue
            if dst.is_dir() and not dst.is_symlink() and any(dst.iterdir()):
                errors.append(f"refusing to replace non-empty directory: {dst}")
                continue
        operations.append(link)
    return operations, errors


def execute_links(
    plan: list[Link], operations: list[Link], *, dry_run: bool, unlink: bool
) -> None:
    operation_set = set(operations)
    for link in plan:
        dst = link.destination
        if link not in operation_set:
            if not unlink:
                info(f"ok: {dst} -> {link.source}")
            continue
        if unlink:
            info(f"would unlink: {dst}" if dry_run else f"unlinked: {dst}")
            if not dry_run:
                dst.unlink()
            continue
        if (dst.exists() or dst.is_symlink()) and not dry_run:
            if dst.is_dir() and not dst.is_symlink():
                dst.rmdir()
            else:
                dst.unlink()
        message = f"{dst} -> {link.source}"
        info(f"would link: {message}" if dry_run else f"linked: {message}")
        if not dry_run:
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.symlink_to(link.source)


def desktop_plan() -> tuple[list[GeneratedFile], list[str]]:
    generated = []
    errors = []
    values = variables()
    source_dir = root() / "desktop"
    data = Path(values["DATA_HOME"])
    replacements = {
        f"@XDG_{key}@": value
        for key, value in values.items()
        if key != "HOME"
    }
    for template in DESKTOP_TEMPLATES:
        source = source_dir / template
        destination = data / "applications" / template.removesuffix(".in")
        if not source.is_file():
            errors.append(f"missing source: {source}")
            continue
        content = source.read_text()
        for token, value in replacements.items():
            content = content.replace(token, value)
        generated.append(GeneratedFile(destination, content))
    return generated, errors


def preflight_generated(
    files: list[GeneratedFile], *, force: bool, check: bool = False
) -> tuple[list[GeneratedFile], list[str]]:
    operations = []
    errors = []
    for artifact in files:
        destination = artifact.destination
        ancestor = symlink_ancestor(destination)
        if ancestor is not None:
            errors.append(f"refusing to operate through symlink ancestor: {ancestor}")
            continue
        if check:
            if (
                not destination.is_file()
                or destination.is_symlink()
                or destination.read_text() != artifact.content
            ):
                errors.append(f"incorrect: {destination}")
            continue
        if (
            destination.is_file()
            and not destination.is_symlink()
            and destination.read_text() == artifact.content
        ):
            continue
        if destination.exists() or destination.is_symlink():
            if not force:
                errors.append(f"already exists: {destination}")
                continue
            if (
                destination.is_dir()
                and not destination.is_symlink()
                and any(destination.iterdir())
            ):
                errors.append(f"refusing to replace non-empty directory: {destination}")
                continue
        operations.append(artifact)
    return operations, errors


def execute_generated(files: list[GeneratedFile], *, dry_run: bool) -> None:
    for artifact in files:
        destination = artifact.destination
        if (destination.exists() or destination.is_symlink()) and not dry_run:
            if destination.is_dir() and not destination.is_symlink():
                destination.rmdir()
            else:
                destination.unlink()
        info(f"would install: {destination}" if dry_run else f"installed: {destination}")
        if not dry_run:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(artifact.content)


def install_opencode_tui_dependencies(npm: str) -> list[str]:
    """Install the TUI plugin tree from the `beta` channel.

    The renderer is shared between host and plugin, so `@opentui` and `solid-js`
    must be the exact builds the host was compiled against, not their latest
    releases. `@opencode-ai/plugin` publishes those builds as optional peers,
    which npm skips, so resolve them from the installed package and install them
    unsaved. Nothing here is version-pinned: an OpenCode upgrade changes the
    peers and the next run follows.

    Declared dependencies are installed by explicit specifier, unsaved, because
    a bare `npm install` leaves an already-installed package alone when its
    dist-tag has moved on, and a saving install rewrites the tag in
    `package.json` into a caret range that resolves to unrelated prerelease
    builds.
    """
    directory = root() / "opencode"

    def run(arguments: list[str], label: str) -> str | None:
        result = subprocess.run(
            [npm, *arguments], cwd=directory, capture_output=True, check=False, text=True
        )
        if not result.returncode:
            return None
        detail = result.stderr.strip() or result.stdout.strip() or "command failed"
        return f"opencode-tui-dependencies ({label} failed: {detail})"

    base = ["install", "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund"]
    try:
        declared = json.loads((directory / "package.json").read_text()).get("dependencies", {})
    except (OSError, json.JSONDecodeError) as detail:
        return [f"opencode-tui-dependencies (could not read dependencies: {detail})"]
    wanted = [f"{name}@{version}" for name, version in sorted(declared.items())]
    if error := run([*base, "--no-save", *wanted], "npm install"):
        return [error]
    manifest = directory / "node_modules/@opencode-ai/plugin/package.json"
    try:
        peers = json.loads(manifest.read_text()).get("peerDependencies", {})
    except (OSError, json.JSONDecodeError) as detail:
        return [f"opencode-tui-dependencies (could not read peers: {detail})"]
    if not peers:
        info("installed: opencode-tui-dependencies")
        return []
    specifiers = [f"{name}@{version}" for name, version in sorted(peers.items())]
    if error := run([*base, "--no-save", *specifiers], "npm install (peers)"):
        return [error]
    info(f"installed: opencode-tui-dependencies ({len(specifiers)} host peers)")
    return []


def actions(dry_run: bool) -> list[str]:
    if dry_run:
        info("would configure: opencode-test service")
        info("would install: opencode-tui-dependencies")
        return []
    errors, executable = [], shutil.which("opencode2")
    if not executable:
        info("skipped service configuration: opencode2 is not on PATH")
    else:
        defaults = {
            "XDG_CONFIG_HOME": "CONFIG_HOME",
            "XDG_DATA_HOME": "DATA_HOME",
            "XDG_STATE_HOME": "STATE_HOME",
            "XDG_CACHE_HOME": "CACHE_HOME",
        }
        # Only the test profile moves off the built-in port, so the default
        # profile keeps whatever OpenCode ships with and is never configured.
        environment = os.environ.copy()
        environment.update(
            {
                key: str(Path(variables()[name]) / "opencode-test")
                for key, name in defaults.items()
            }
        )
        for key, value in (("hostname", "127.0.0.1"), ("port", "4099")):
            result = subprocess.run(
                [executable, "service", "set", key, value],
                env=environment,
                capture_output=True,
                check=False,
                text=True,
            )
            if result.returncode:
                detail = result.stderr.strip() or result.stdout.strip() or "command failed"
                errors.append(
                    f"opencode-test/service (could not set {key}: {detail})"
                )
                break
        else:
            info("configured: opencode-test/service -> 127.0.0.1:4099")
    npm = shutil.which("npm")
    if not npm:
        info("skipped TUI plugin dependencies: npm is not on PATH")
    else:
        errors.extend(install_opencode_tui_dependencies(npm))
    return errors


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    configure_logging()
    parser = argparse.ArgumentParser(
        usage="%(prog)s [OPTIONS]",
        description=(
            "Link repo-managed config into the selected XDG locations. By default, "
            "OpenCode config is selected."
        ),
        epilog=(
            "Manifest paths are interpreted relative to the repository root, including "
            "paths in a custom manifest.\n"
            "Existing matching symlinks are left unchanged. --force replaces regular "
            "files, symlinks, and empty directories only."
        ),
        formatter_class=HelpFormatter,
    )
    group_help = {
        "opencode": "Link OpenCode config",
        "claude": "Link Claude Code config",
        "herdr": "Link Herdr config",
        "dotfiles": "Link dotfiles config",
    }
    for short, name in (
        ("-o", "opencode"),
        ("-c", "claude"),
        (None, "herdr"),
        ("-d", "dotfiles"),
    ):
        parser.add_argument(
            *(filter(None, (short, "--" + name))),
            action="store_true",
            help=group_help[name],
        )
    parser.add_argument(
        "-a",
        "--all",
        action="store_true",
        help="Select OpenCode, Claude Code, Herdr, and dotfiles config",
    )
    parser.add_argument(
        "--force", action="store_true", help="Replace existing safe objects"
    )
    parser.add_argument(
        "--manifest", type=Path, help="Read mappings from PATH (sources remain repo-relative)"
    )
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument(
        "--check",
        action="store_true",
        help="Check links without writing or running actions",
    )
    modes.add_argument(
        "--dry-run",
        action="store_true",
        help="Describe links and actions without writing",
    )
    modes.add_argument(
        "--unlink",
        action="store_true",
        help="Remove only matching managed symlinks",
    )
    args = parser.parse_args(argv)
    groups = {
        name
        for name in ("opencode", "claude", "herdr", "dotfiles")
        if args.all or getattr(args, name)
    } or {"opencode"}
    try:
        plan = build_plan(groups, args.manifest)
    except ValueError as error:
        return fail(str(error))
    generated = []
    generated_operations = []
    errors = []
    if "opencode" in groups:
        generated, desktop_errors = desktop_plan()
        errors.extend(desktop_errors)
        if not args.unlink:
            generated_operations, generated_errors = preflight_generated(
                generated, force=args.force, check=args.check
            )
            errors.extend(generated_errors)

    link_operations, link_errors = preflight_links(
        plan,
        force=args.force,
        unlink=args.unlink,
        check=args.check,
    )
    errors.extend(link_errors)

    if not errors and not args.check:
        execute_links(
            plan,
            link_operations,
            dry_run=args.dry_run,
            unlink=args.unlink,
        )
        if not args.unlink:
            execute_generated(generated_operations, dry_run=args.dry_run)
            if "opencode" in groups:
                errors.extend(actions(args.dry_run))
    info("")
    if errors:
        info(f"Link summary: {len(errors)} error(s)")
    elif args.dry_run:
        info("Link summary: dry run completed; no changes were made.")
    elif args.unlink:
        info("Link summary: selected managed symlinks were removed.")
    else:
        info("Link summary: all selected config symlinks are correct.")
    for error in errors:
        fail(error)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
