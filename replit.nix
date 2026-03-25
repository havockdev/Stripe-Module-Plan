{pkgs}: {
  deps = [
    pkgs.gcc-unwrapped
    pkgs.fontconfig
    pkgs.freetype
    pkgs.dbus
    pkgs.alsa-lib
    pkgs.glib
    pkgs.gdk-pixbuf
    pkgs.cairo
    pkgs.atk
    pkgs.pango
    pkgs.gtk3
    pkgs.xorg.libXrender
    pkgs.xorg.libXi
    pkgs.xorg.libXfixes
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcursor
    pkgs.xorg.libXcomposite
    pkgs.xorg.libXrandr
    pkgs.xorg.libXext
    pkgs.xorg.libX11
    pkgs.xorg.libxcb
  ];
}
