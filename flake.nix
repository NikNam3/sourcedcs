{
  description = "SOURCE DCS — ATO brief, GCI server, and .miz→YAML tooling";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # Node.js versions matching each service's Dockerfile
        nodejs22 = pkgs.nodejs_22;

        # Python environment for repo tooling plus lxsrs_v2 development
        pythonEnv = pkgs.python3.withPackages (ps: [
          ps.pyyaml
          ps.pytest
          ps.numpy
          ps.pandas
          ps.matplotlib
          ps.sounddevice
          ps.pynput
          ps.opuslib
        ]);

      in {
        devShells.default = pkgs.mkShell {
          name = "sourcedcs";
          buildInputs = [
            nodejs22
            pythonEnv
            pkgs.docker
            pkgs.docker-compose
            pkgs.libopus
            pkgs.portaudio
            pkgs.libpulseaudio
            pkgs.espeak-ng
            pkgs.ffmpeg
            pkgs.opus-tools
            pkgs.wine64
          ];
          LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [ pkgs.portaudio pkgs.libopus pkgs.libpulseaudio ];
          shellHook = ''
            echo "SOURCE DCS dev shell"
            echo "  node    $(node --version)"
            echo "  python  $(python3 --version)"
            echo ""
            echo "Individual services:"
            echo "  miztoyaml:    python3 -m tools.miztoyaml <file.miz>"
            echo "  atobrief:     cd atobrief    && PORT=4000 npm start"
            echo "  sourcedcs-web: cd sourcedcs-web && PORT=7000 npm start"
            echo "  lxsrs_v2:     python3 -m lxsrs_v2 --freq 251.0 --ui"
            echo "  tests:        python3 -m pytest tools/tests/ -v"
            echo ""
            echo "Full stack (Docker Compose):"
            echo "  cp .env.example infra/.env && \$EDITOR infra/.env"
            echo "  cd infra && docker compose up -d"
            echo ""
            echo "lxsrs_v2 dependencies ready:"
            echo "  tts:   $(espeak-ng --version 2>&1 | head -n1 || echo 'espeak-ng available')"
              # electron-packager expects wine64
              mkdir -p $HOME/.local/bin
              ln -sf $(which wine) $HOME/.local/bin/wine64
              export PATH="$HOME/.local/bin:$PATH"

              echo "SOURCE DCS dev shell"

          '';
        };

        # Separate dev shell for just lxsrs_v2 development
        devShells.srs = pkgs.mkShell {
          name = "lxsrs-v2-dev";
          buildInputs = [
              pythonEnv
              pkgs.libopus
              pkgs.portaudio
              pkgs.libpulseaudio
              pkgs.espeak-ng
              pkgs.ffmpeg
              pkgs.opus-tools
              pkgs.python3Packages.evdev   # ← add this
              pkgs.python3                 # ← provides Python.h
            ];
          LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [ pkgs.portaudio pkgs.libopus pkgs.libpulseaudio ];

          shellHook = ''
            echo "lxsrs_v2 Development Environment"
            echo "  python: $(python3 --version)"
            echo ""
            echo "Run UI:   python3 -m lxsrs_v2 --freq 251.0 --tx-freq 251.0 --ui"
            echo "Run RX:   python3 -m lxsrs_v2 --freq 251.0"
            echo "Tests:    python3 -m pytest lxsrs_v2/tests -v"
          '';
        };
      }
    );
}
