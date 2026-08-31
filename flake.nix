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

        # miztoyaml — DCS .miz → ATO brief YAML CLI tool
        miztoyaml = pkgs.python3Packages.buildPythonApplication {
          pname = "miztoyaml";
          version = "0.1.0";
          src = ./tools;
          format = "other";
          propagatedBuildInputs = [ pkgs.python3Packages.pyyaml ];
          installPhase = ''
            mkdir -p $out/lib/python3/site-packages/tools
            cp -r $src/miztoyaml $out/lib/python3/site-packages/tools/miztoyaml
            mkdir -p $out/bin
            cat > $out/bin/miztoyaml <<'EOF'
            #!${pkgs.python3}/bin/python3
            import sys, os
            sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..', 'lib', 'python3', 'site-packages'))
            from tools.miztoyaml import main
            main()
            EOF
            chmod +x $out/bin/miztoyaml
          '';
        };

        # atobrief — tactical briefing web app (Express + js-yaml + socket.io)
        atobrief = pkgs.buildNpmPackage {
          pname = "atobrief";
          version = "1.0.0";
          src = ./atobrief;
          nodejs = nodejs22;
          npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
          installPhase = ''
            mkdir -p $out/share/atobrief
            cp server.js package.json $out/share/atobrief/
            cp -r public/ $out/share/atobrief/public/
            cp -r data/   $out/share/atobrief/data/
            cp -r node_modules/ $out/share/atobrief/node_modules/
            mkdir -p $out/bin
            cat > $out/bin/atobrief <<EOF
            #!/usr/bin/env sh
            cd $out/share/atobrief
            exec ${nodejs22}/bin/node server.js "\$@"
            EOF
            chmod +x $out/bin/atobrief
          '';
        };

        # sourcedcs-web — main website (Express)
        sourcedcs-web = pkgs.buildNpmPackage {
          pname = "sourcedcs-web";
          version = "1.0.0";
          src = ./sourcedcs-web;
          nodejs = nodejs22;
          npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
          installPhase = ''
            mkdir -p $out/share/sourcedcs-web
            cp server.js package.json $out/share/sourcedcs-web/
            cp -r public/ $out/share/sourcedcs-web/public/
            cp -r node_modules/ $out/share/sourcedcs-web/node_modules/
            mkdir -p $out/share/sourcedcs-web/data
            mkdir -p $out/bin
            cat > $out/bin/sourcedcs-web <<EOF
            #!/usr/bin/env sh
            cd $out/share/sourcedcs-web
            exec ${nodejs22}/bin/node server.js "\$@"
            EOF
            chmod +x $out/bin/sourcedcs-web
          '';
        };

        # lxsrs_v2 — Linux-oriented Python SRS client prototype
        lxsrs_v2 = pkgs.python3Packages.buildPythonApplication {
          pname = "lxsrs-v2";
          version = "0.1.0";
          src = ./.;
          format = "other";
          propagatedBuildInputs = [
            pkgs.python3Packages.numpy
            pkgs.python3Packages.sounddevice
            pkgs.python3Packages.pynput
            pkgs.python3Packages.opuslib
          ];
          buildInputs = [
            pkgs.libopus
            pkgs.portaudio
            pkgs.libpulseaudio
          ];
          nativeBuildInputs = [
            pkgs.makeWrapper
          ];
          dontBuild = true;
          installPhase = ''
            mkdir -p $out/lib/${pkgs.python3.sitePackages}
            cp -r lxsrs_v2 $out/lib/${pkgs.python3.sitePackages}/
            mkdir -p $out/bin
            makeWrapper ${pkgs.python3}/bin/python3 $out/bin/lxsrs_v2 \
              --prefix PYTHONPATH : $out/lib/${pkgs.python3.sitePackages} \
              --prefix LD_LIBRARY_PATH : ${pkgs.lib.makeLibraryPath [ pkgs.portaudio pkgs.libopus pkgs.libpulseaudio ]} \
              --add-flags "-m lxsrs_v2"
          '';
        };

      in {
        packages = {
          inherit miztoyaml atobrief sourcedcs-web lxsrs_v2;
          default = miztoyaml;
        };

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
