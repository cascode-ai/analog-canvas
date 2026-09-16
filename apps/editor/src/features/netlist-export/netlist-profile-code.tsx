export function NetlistProfileCode({
  text,
  error,
  onChange,
}: {
  text: string;
  error: string | null;
  onChange(text: string): void;
}) {
  return (
    <section
      className="netlist-profile-code"
      aria-label="Netlist configuration"
    >
      <h2>Netlist configuration</h2>
      <p>
        Edit or paste the complete JSON. Process and Format are selected in the
        live Netlist panel. TSMC presets use the reference device names; point
        each library path at your installed PDK. Existing component values take
        priority.
      </p>
      <textarea
        aria-label="Netlist configuration JSON"
        value={text}
        onChange={(event) => onChange(event.currentTarget.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        aria-invalid={!!error}
      />
      {error ? (
        <p role="alert">
          {error} Copying is paused until the configuration is valid.
        </p>
      ) : (
        <p>
          Saved in this browser. Library paths refer to your simulator's
          installed models.
        </p>
      )}
    </section>
  );
}
