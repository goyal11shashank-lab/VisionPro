import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { Search, ChevronDown, X, Check, Loader2 } from 'lucide-react';
import { rankSearchMatch } from '../../utils/searchNormalization';

export interface SearchableOption {
  id: string;
  label: string;
  subLabel?: string;
  tag?: string;
  badgeColor?: 'blue' | 'emerald' | 'purple' | 'amber' | 'slate';
  meta?: any;
}

export interface SearchableMasterSelectProps {
  id?: string;
  name?: string;
  placeholder?: string;
  value?: string; // Current selected item ID
  displayValue?: string; // Optional prefilled display text if options aren't fully resolved yet
  options?: SearchableOption[]; // In-memory/prefetched options
  onSearch?: (query: string) => Promise<SearchableOption[]> | SearchableOption[];
  onSelect: (option: SearchableOption | null) => void;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  className?: string;
  inputClassName?: string;
  dropdownClassName?: string;
  ariaLabel?: string;
  onNextFocus?: () => void;
  allowClear?: boolean;
  emptyMessage?: string;
  loadingMessage?: string;
}

export interface SearchableMasterSelectRef {
  focus: () => void;
  blur: () => void;
  open: () => void;
  close: () => void;
}

export const SearchableMasterSelect = forwardRef<SearchableMasterSelectRef, SearchableMasterSelectProps>(
  (
    {
      id,
      name,
      placeholder = 'Type to search...',
      value = '',
      displayValue,
      options = [],
      onSearch,
      onSelect,
      disabled = false,
      required = false,
      autoFocus = false,
      className = '',
      inputClassName = '',
      dropdownClassName = '',
      ariaLabel,
      onNextFocus,
      allowClear = true,
      emptyMessage = 'No matching records found',
      loadingMessage = 'Searching master records...',
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filteredOptions, setFilteredOptions] = useState<SearchableOption[]>(options);
    const [highlightedIndex, setHighlightedIndex] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedOption, setSelectedOption] = useState<SearchableOption | null>(null);

    // Expose focus/open/close controls to parent via ref
    useImperativeHandle(ref, () => ({
      focus: () => {
        inputRef.current?.focus();
        inputRef.current?.select();
      },
      blur: () => {
        inputRef.current?.blur();
      },
      open: () => {
        setIsOpen(true);
      },
      close: () => {
        setIsOpen(false);
      },
    }));

    // Find currently selected option from value and options list
    useEffect(() => {
      if (!value) {
        setSelectedOption(null);
        if (!isOpen) {
          setSearchQuery('');
        }
        return;
      }

      const match = options.find(o => o.id === value);
      if (match) {
        setSelectedOption(match);
        if (!isOpen) {
          setSearchQuery(match.label);
        }
      } else if (displayValue) {
        setSelectedOption({ id: value, label: displayValue });
        if (!isOpen) {
          setSearchQuery(displayValue);
        }
      }
    }, [value, options, displayValue, isOpen]);

    // Perform filtering or search query
    useEffect(() => {
      let active = true;

      const performFilter = async () => {
        const query = searchQuery.trim().toLowerCase();

        if (onSearch) {
          setIsLoading(true);
          try {
            const results = await onSearch(searchQuery);
            if (active) {
              setFilteredOptions(results || []);
              setIsLoading(false);
            }
          } catch (err) {
            if (active) {
              setFilteredOptions([]);
              setIsLoading(false);
            }
          }
        } else {
          // In-memory client-side filter using symbol-insensitive search and power normalization
          if (!query) {
            setFilteredOptions(options);
          } else {
            const ranked = rankSearchMatch(options, searchQuery, opt => ({
              id: opt.id,
              name: opt.label,
              code: opt.tag || opt.meta?.code,
              barcode: opt.meta?.barcode,
              sph: opt.meta?.sph,
              cyl: opt.meta?.cyl,
              axis: opt.meta?.axis,
              add: opt.meta?.add,
              side: opt.meta?.side,
              categoryCode: opt.meta?.categoryCode,
              rawText: `${opt.subLabel || ''} ${opt.tag || ''}`,
            }));
            setFilteredOptions(ranked);
          }
        }
      };

      const timer = setTimeout(() => {
        performFilter();
      }, onSearch ? 180 : 0);

      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [searchQuery, options, onSearch]);

    // Reset highlighted index when filtered options change
    useEffect(() => {
      if (filteredOptions.length > 0) {
        // Try to keep currently selected item highlighted if present in filtered list
        const curIdx = filteredOptions.findIndex(o => o.id === value);
        setHighlightedIndex(curIdx >= 0 ? curIdx : 0);
      } else {
        setHighlightedIndex(-1);
      }
    }, [filteredOptions, value]);

    // Scroll highlighted item into view
    useEffect(() => {
      if (isOpen && listRef.current && highlightedIndex >= 0) {
        const activeItem = listRef.current.children[highlightedIndex] as HTMLElement;
        if (activeItem) {
          activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    }, [highlightedIndex, isOpen]);

    // Close dropdown on outside click
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
          setIsOpen(false);
          // Restore valid committed display text
          if (selectedOption) {
            setSearchQuery(selectedOption.label);
          } else if (!value) {
            setSearchQuery('');
          }
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, [selectedOption, value]);

    const handleSelect = useCallback(
      (option: SearchableOption | null, shouldTriggerNextFocus: boolean = true) => {
        setSelectedOption(option);
        if (option) {
          setSearchQuery(option.label);
          onSelect(option);
        } else {
          setSearchQuery('');
          onSelect(null);
        }
        setIsOpen(false);

        if (shouldTriggerNextFocus && onNextFocus) {
          // Allow render loop to complete, then focus next field
          setTimeout(() => {
            onNextFocus();
          }, 40);
        }
      },
      [onSelect, onNextFocus]
    );

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else if (filteredOptions.length > 0) {
          setHighlightedIndex(prev => (prev + 1) % filteredOptions.length);
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else if (filteredOptions.length > 0) {
          setHighlightedIndex(prev => (prev - 1 + filteredOptions.length) % filteredOptions.length);
        }
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault(); // Prevent accidental form submission
        if (isOpen && highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
          handleSelect(filteredOptions[highlightedIndex], true);
        } else if (!isOpen) {
          // If closed and pressed Enter, open dropdown or advance
          if (value && onNextFocus) {
            onNextFocus();
          } else {
            setIsOpen(true);
          }
        }
        return;
      }

      if (e.key === 'Tab') {
        // In Tally style: if dropdown is open and an item is actively highlighted, commit that item on Tab
        if (isOpen && highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
          handleSelect(filteredOptions[highlightedIndex], false);
        }
        setIsOpen(false);
        // Do NOT preventDefault so natural browser Tab navigation can also proceed
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        if (selectedOption) {
          setSearchQuery(selectedOption.label);
        } else if (!value) {
          setSearchQuery('');
        }
        return;
      }
    };

    const handleClear = (e: React.MouseEvent) => {
      e.stopPropagation();
      handleSelect(null, false);
      inputRef.current?.focus();
    };

    const getBadgeStyle = (color?: string) => {
      switch (color) {
        case 'emerald':
          return 'bg-emerald-50 text-emerald-700 border-emerald-200';
        case 'purple':
          return 'bg-purple-50 text-purple-700 border-purple-200';
        case 'amber':
          return 'bg-amber-50 text-amber-700 border-amber-200';
        case 'slate':
          return 'bg-slate-100 text-slate-600 border-slate-200';
        case 'blue':
        default:
          return 'bg-blue-50 text-blue-700 border-blue-200';
      }
    };

    return (
      <div ref={containerRef} className={`relative w-full ${className}`}>
        {/* Input Wrapper */}
        <div className="relative flex items-center">
          <input
            ref={inputRef}
            id={id}
            name={name}
            type="text"
            role="combobox"
            aria-expanded={isOpen}
            aria-label={ariaLabel || placeholder}
            aria-autocomplete="list"
            disabled={disabled}
            required={required}
            autoFocus={autoFocus}
            value={searchQuery ?? ''}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck="false"
            onFocus={() => {
              setIsOpen(true);
              inputRef.current?.select();
            }}
            onChange={e => {
              setSearchQuery(e.target.value);
              if (!isOpen) setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            className={`w-full pl-8 pr-14 py-1.5 text-xs font-medium rounded-lg border transition-all ${
              isOpen
                ? 'border-blue-500 ring-2 ring-blue-500/20 bg-white'
                : 'border-slate-300 bg-white hover:border-slate-400'
            } text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed ${inputClassName}`}
          />

          {/* Left search icon */}
          <div className="absolute left-2.5 pointer-events-none text-slate-400">
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
            ) : (
              <Search className="w-3.5 h-3.5" />
            )}
          </div>

          {/* Right action icons (clear + chevron) */}
          <div className="absolute right-2 flex items-center gap-1">
            {allowClear && !disabled && (value || searchQuery) && (
              <button
                type="button"
                tabIndex={-1}
                onClick={handleClear}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                title="Clear selection"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onClick={() => {
                if (!disabled) {
                  setIsOpen(!isOpen);
                  inputRef.current?.focus();
                }
              }}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 transition-colors"
            >
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-150 ${
                  isOpen ? 'rotate-180 text-blue-600' : ''
                }`}
              />
            </button>
          </div>
        </div>

        {/* Dropdown Menu */}
        {isOpen && !disabled && (
          <div
            className={`absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden text-xs max-h-64 flex flex-col animate-in fade-in-50 zoom-in-95 duration-100 ${dropdownClassName}`}
          >
            {/* Header / counter bar */}
            <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span className="font-semibold uppercase tracking-wider text-[10px]">
                Matching Options ({filteredOptions.length})
              </span>
              <span className="font-mono text-[10px] text-slate-400">↑↓ to navigate • Enter to select</span>
            </div>

            {/* List */}
            <ul
              ref={listRef}
              role="listbox"
              className="overflow-y-auto divide-y divide-slate-50 flex-1 py-1 focus:outline-none"
            >
              {isLoading ? (
                <li className="px-3 py-4 text-center text-slate-500 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <span>{loadingMessage}</span>
                </li>
              ) : filteredOptions.length === 0 ? (
                <li className="px-3 py-5 text-center text-slate-400 space-y-1">
                  <p className="font-medium text-slate-600">{emptyMessage}</p>
                  <p className="text-[11px] text-slate-400">
                    No results for &ldquo;{searchQuery}&rdquo;
                  </p>
                </li>
              ) : (
                filteredOptions.map((opt, index) => {
                  const isHighlighted = index === highlightedIndex;
                  const isSelected = opt.id === value;

                  return (
                    <li
                      key={opt.id}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onMouseDown={e => {
                        // Prevent input blur before click handler fires
                        e.preventDefault();
                      }}
                      onClick={() => handleSelect(opt, true)}
                      className={`px-3 py-2 cursor-pointer flex items-center justify-between gap-2 transition-colors ${
                        isHighlighted
                          ? 'bg-blue-50/90 text-blue-950 font-medium'
                          : 'text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold">{opt.label}</span>
                          {opt.tag && (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${getBadgeStyle(
                                opt.badgeColor
                              )}`}
                            >
                              {opt.tag}
                            </span>
                          )}
                        </div>
                        {opt.subLabel && (
                          <div className="text-[11px] text-slate-500 truncate mt-0.5 font-mono">
                            {opt.subLabel}
                          </div>
                        )}
                      </div>

                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-blue-600 shrink-0 stroke-[2.5]" />
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        )}
      </div>
    );
  }
);

SearchableMasterSelect.displayName = 'SearchableMasterSelect';
export default SearchableMasterSelect;
